/**
 * OpenAI 兼容 chat/completions 客户端：
 * - 流式 SSE（fetch ReadableStream；Tauri 下可注入 tauri-plugin-http 的 fetch）
 * - 429/5xx 指数退避重试
 * - finish_reason=length 截断续写
 * - 思考标签剥离、JSON 鲁棒抽取
 * - 全链路超时兜底：连接 15s / 流式首 token 60s / 流式空闲 60s / 非流式整体 300s
 * - HTTP 200 但非 OpenAI 形状的错误体识别（旧网关 401 也返回 200）
 */

import { stripThinking, extractJson } from './extract';

export interface ChannelConfig {
  id: string;
  name: string;
  kind: 'text' | 'image';
  baseUrl: string;
  apiKey: string;
  modelId: string;
  isActive: boolean;
  /** 额外请求体字段（temperature 等） */
  extraBody?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** 流式回调（收到增量文本）。缺省则走非流式请求 */
  onDelta?: (delta: string, full: string) => void;
  signal?: AbortSignal;
  /** 最大自动续写次数（finish_reason=length 时拼接续写） */
  maxContinues?: number;
  temperature?: number;
  maxTokens?: number;
  /** 期望 JSON 输出（附加响应格式提示 + 自动抽取） */
  jsonMode?: boolean;
  /** 重试次数（429/5xx），默认 3 */
  retries?: number;
  /** 超时（毫秒），0 关闭对应项。流式请求的响应头等待时间，默认 15s */
  connectTimeoutMs?: number;
  /** 流式首 token 超时，默认 60s */
  firstTokenTimeoutMs?: number;
  /** 流式两 chunk 之间空闲超时，默认 60s */
  idleTimeoutMs?: number;
  /** 非流式请求整体超时（响应头在生成完成后才返回，需长时限），默认 300s */
  nonStreamTimeoutMs?: number;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

export class LlmError extends Error {
  constructor(message: string, public status?: number, public retryable?: boolean) {
    super(message);
  }
}

const DEFAULT_RETRIES = 3;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_NONSTREAM_TIMEOUT_MS = 300_000;
/** 测连是 5 token 的最小请求，用更短的兜底时限 */
const TEST_CHAT_TIMEOUT_MS = 30_000;

/**
 * 识别「HTTP 200 但非 OpenAI 形状」的错误响应体：
 * 旧网关鉴权失败也返回 200 + {"code":401,...}（无 choices/非 SSE）。
 * 返回人类可读的错误描述；正常 OpenAI 形状返回 null。
 */
export function inspectLlmErrorBody(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return `响应体异常：${String(json).slice(0, 200)}`;
  const obj = json as Record<string, unknown>;
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    // 部分网关 200 仍在 choices[0].error 嵌错误
    const inner = (choices[0] as Record<string, unknown> | undefined)?.error;
    return inner ? serverErrMsg(inner) ?? JSON.stringify(inner).slice(0, 200) : null;
  }
  return serverErrMsg(obj) ?? '响应缺少 choices（Base URL 路径可能填错，或渠道服务异常）';
}

function serverErrMsg(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.error === 'string') return o.error;
  if (typeof o.error === 'object' && o.error !== null) return serverErrMsg(o.error);
  if (o.success === false) return String(o.msg ?? o.message ?? JSON.stringify(o).slice(0, 200));
  const code = o.code;
  const codeBad = typeof code === 'number' ? code !== 0 : code !== undefined && String(code).toUpperCase() !== 'OK';
  if (code !== undefined && codeBad) {
    return `${String(code)}: ${String(o.msg ?? o.message ?? JSON.stringify(o).slice(0, 160))}`;
  }
  if (typeof o.message === 'string' && o.message) return o.message;
  return null;
}

interface ResponseHandle {
  res: Response;
  ctrl: AbortController;
  /** 移除外部 signal → 内部 ctrl 的桥接（body 读取结束后调用） */
  dispose: () => void;
}

export class LlmClient {
  constructor(
    public config: ChannelConfig,
    /** fetch 实现（浏览器默认 globalThis.fetch；Tauri 模式注入插件 fetch） */
    private fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private endpoint(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    if (/\/(chat\/completions|completions|images\/generations)$/.test(base)) return base;
    return `${base}${path}`;
  }

  private static optMs(value: number | undefined, fallback: number): number {
    return value === undefined ? fallback : value;
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const retries = options.retries ?? DEFAULT_RETRIES;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.chatOnce(options, started);
      } catch (e) {
        const err = e as LlmError;
        const canRetry = (err.retryable ?? false) && attempt < retries && !options.signal?.aborted;
        if (!canRetry) throw e;
        attempt++;
        const backoff = Math.min(800 * 2 ** (attempt - 1), 15_000);
        await sleep(backoff);
      }
    }
  }

  private async chatOnce(options: ChatOptions, started: number): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.config.modelId,
      messages: options.messages,
      stream: Boolean(options.onDelta),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(this.config.extraBody ?? {}),
    };
    const stream = Boolean(options.onDelta);
    // 流式：响应头应立即返回，短时限抓连接故障；非流式：生成完成后才有响应头，需整体长时限
    const headerTimeoutMs = stream
      ? LlmClient.optMs(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
      : LlmClient.optMs(options.nonStreamTimeoutMs, DEFAULT_NONSTREAM_TIMEOUT_MS);

    const handle = await this.request(this.endpoint('/chat/completions'), body, options.signal, headerTimeoutMs);
    try {
      const contentType = handle.res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return await this.consumeSse(handle, options, started);
      }
      return await this.consumeJson(handle, options, body, started);
    } finally {
      handle.dispose();
    }
  }

  /** 非流式路径：响应体校验（200 但非 OpenAI 形状 → 明确报错）+ 截断续写 */
  private async consumeJson(handle: ResponseHandle, options: ChatOptions, body: Record<string, unknown>, started: number): Promise<ChatResult> {
    const json = (await handle.res.json()) as OpenAiChatBody;
    assertOpenAiShape(json);
    let text = json.choices?.[0]?.message?.content ?? '';
    const usage = json.usage ?? {};
    let promptTokens = usage.prompt_tokens ?? 0;
    let completionTokens = usage.completion_tokens ?? 0;

    let finish = json.choices?.[0]?.finish_reason;
    let continues = 0;
    const maxCont = options.maxContinues ?? 0;
    while (finish === 'length' && continues < maxCont && !options.signal?.aborted) {
      continues++;
      const contBody = {
        ...body,
        stream: false,
        messages: [...options.messages, { role: 'assistant', content: text }, { role: 'user', content: '继续，从中断处直接接着写，不要重复、不要解释。' }],
      };
      const cont = await this.request(this.endpoint('/chat/completions'), contBody, options.signal, LlmClient.optMs(options.nonStreamTimeoutMs, DEFAULT_NONSTREAM_TIMEOUT_MS));
      try {
        const cj = (await cont.res.json()) as OpenAiChatBody;
        assertOpenAiShape(cj);
        const piece = cj.choices?.[0]?.message?.content ?? '';
        text += piece;
        finish = cj.choices?.[0]?.finish_reason;
        promptTokens += cj.usage?.prompt_tokens ?? 0;
        completionTokens += cj.usage?.completion_tokens ?? 0;
      } finally {
        cont.dispose();
      }
    }

    options.onDelta?.(text, text);
    return { text, promptTokens, completionTokens, ms: Date.now() - started };
  }

  private async consumeSse(handle: ResponseHandle, options: ChatOptions, started: number): Promise<ChatResult> {
    const reader = handle.res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let finishReason: string | undefined;
    let promptTokens = 0;
    let completionTokens = 0;
    let parseFailures = 0;
    const firstTokenMs = LlmClient.optMs(options.firstTokenTimeoutMs, DEFAULT_FIRST_TOKEN_TIMEOUT_MS);
    const idleMs = LlmClient.optMs(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
    let deadlineMs = firstTokenMs;

    try {
      for (;;) {
        let timedOut = false;
        const timer = deadlineMs > 0
          ? setTimeout(() => { timedOut = true; handle.ctrl.abort(); }, deadlineMs)
          : undefined;
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (e) {
          if (timedOut) {
            throw new LlmError(
              deadlineMs === firstTokenMs
                ? `首 token 超时：${Math.round(firstTokenMs / 1000)}s 内模型未开始输出（可检查模型是否可用）`
                : `流式空闲超时：${Math.round(idleMs / 1000)}s 未收到新数据，连接已中断`,
              undefined, true,
            );
          }
          if (options.signal?.aborted) throw new LlmError('请求已取消', undefined, false);
          throw e;
        } finally {
          if (timer) clearTimeout(timer);
        }
        deadlineMs = idleMs;
        const { done, value } = readResult;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload) as {
              choices?: { delta?: { content?: string }, finish_reason?: string | null }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              error?: unknown;
            };
            if (evt.error) {
              throw new LlmError(`服务端流式返回错误：${serverErrMsg(evt.error) ?? JSON.stringify(evt.error).slice(0, 200)}`, undefined, false);
            }
            const delta = evt.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              full += delta;
              options.onDelta?.(delta, full);
            }
            if (evt.choices?.[0]?.finish_reason) finishReason = evt.choices[0].finish_reason;
            if (evt.usage) {
              promptTokens = evt.usage.prompt_tokens ?? promptTokens;
              completionTokens = evt.usage.completion_tokens ?? completionTokens;
            }
          } catch (e) {
            if (e instanceof LlmError) throw e;
            parseFailures++;
          }
        }
      }
    } finally {
      // 异常退出时释放底层连接
      try { await reader.cancel(); } catch { /* 已关闭 */ }
    }

    // 流以空文本收尾：不再静默返回空串（旧网关 200 错误体的典型表现）
    if (!full.trim()) {
      const why = parseFailures > 0 ? `（含 ${parseFailures} 行无法解析的数据）` : '';
      const tail = finishReason ? `，finish_reason=${finishReason}` : '';
      throw new LlmError(`流式响应结束但未收到任何文本${why}${tail}。请检查 Base URL 是否填到版本号一级、模型 ID 是否正确`, undefined, false);
    }

    if (!completionTokens) completionTokens = roughTokens(full);
    if (!promptTokens) promptTokens = roughTokens(options.messages.map((m) => m.content).join('\n'));

    // 流式截断续写：与非流式路径一致，把已生成的前文作为 assistant 消息带回，
    // 否则模型看不到已写内容，会重新生成一份不相干回答
    if (finishReason === 'length' && (options.maxContinues ?? 0) > 0 && !options.signal?.aborted) {
      const savedStream = options.onDelta;
      const contBody = {
        model: this.config.modelId,
        stream: false,
        messages: [
          ...options.messages,
          { role: 'assistant', content: full },
          { role: 'user', content: '继续，从中断处直接接着写，不要重复、不要解释。' },
        ],
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(this.config.extraBody ?? {}),
      };
      try {
        const cont = await this.request(this.endpoint('/chat/completions'), contBody, options.signal, LlmClient.optMs(options.nonStreamTimeoutMs, DEFAULT_NONSTREAM_TIMEOUT_MS));
        try {
          const cj = (await cont.res.json()) as OpenAiChatBody;
          assertOpenAiShape(cj);
          const piece = cj.choices?.[0]?.message?.content ?? '';
          full += piece;
          promptTokens += cj.usage?.prompt_tokens ?? 0;
          completionTokens += cj.usage?.completion_tokens ?? roughTokens(piece);
          savedStream?.(piece, full);
        } finally {
          cont.dispose();
        }
      } catch {
        /* 续写失败时按截断内容返回 */
      }
    }

    return { text: full, promptTokens, completionTokens, ms: Date.now() - started };
  }

  /**
   * 发起 POST。返回内部 AbortController 供流式空闲超时复用；
   * timeoutMs 只覆盖「响应头等待」阶段（到 header 即清除）。
   */
  private async request(url: string, body: unknown, signal: AbortSignal | undefined, timeoutMs: number): Promise<ResponseHandle> {
    const ctrl = new AbortController();
    let externalCancelled = false;
    const onExternalAbort = () => { externalCancelled = true; ctrl.abort(); };
    if (signal) {
      if (signal.aborted) { externalCancelled = true; ctrl.abort(); }
      else signal.addEventListener('abort', onExternalAbort);
    }
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs)
      : undefined;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) throw new LlmError(`连接超时：${Math.round(timeoutMs / 1000)}s 内未收到服务器响应`, undefined, true);
      if (externalCancelled) throw new LlmError('请求已取消', undefined, false);
      throw new LlmError(`网络请求失败：${(e as Error).message}`, undefined, true);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.ok) {
      return { res, ctrl, dispose: () => signal?.removeEventListener('abort', onExternalAbort) };
    }
    signal?.removeEventListener('abort', onExternalAbort);
    const retryable = res.status === 429 || res.status >= 500;
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch { /* ignore */ }
    throw new LlmError(`API 错误 ${res.status}：${detail || res.statusText}`, res.status, retryable);
  }

  /** 一键测连：直接 POST 一条最小 chat（部分渠道 key 无 /models 权限，拉模型列表另用 listModels） */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.config.modelId.trim()) {
      return { ok: false, message: '未设置模型 ID：请先手填或在渠道上点「拉模型」' };
    }
    try {
      const r = await this.chat({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 5,
        retries: 0,
        nonStreamTimeoutMs: TEST_CHAT_TIMEOUT_MS,
      });
      return { ok: true, message: `连接成功（模型响应 ${r.ms}ms${r.text.trim() ? '' : '，但返回内容为空'}）` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 拉取模型列表 */
  async listModels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
    });
    if (!res.ok) throw new LlmError(`拉取模型列表失败：HTTP ${res.status}（部分渠道的 key 无 models 权限，可直接手填模型 ID）`, res.status);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
  }

  /** JSON 模式便捷方法 */
  async chatJson<T>(options: Omit<ChatOptions, 'jsonMode'>): Promise<T> {
    const result = await this.chat({ ...options, jsonMode: true });
    return extractJson<T>(result.text);
  }
}

interface OpenAiChatBody {
  choices?: { message?: { content?: string }, finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** HTTP 200 但非 OpenAI 形状 → 抛出带服务端 msg 的 LlmError */
function assertOpenAiShape(json: OpenAiChatBody): void {
  const msg = inspectLlmErrorBody(json);
  if (msg) throw new LlmError(`服务端返回错误：${msg}`, undefined, false);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function roughTokens(s: string): number {
  // 中英混合粗估：CJK≈1 token/字，拉丁≈1 token/4 chars
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const rest = s.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

export { stripThinking, extractJson };
