/**
 * OpenAI 兼容 chat/completions 客户端：
 * - 流式 SSE（fetch ReadableStream；Tauri 下可注入 tauri-plugin-http 的 fetch）
 * - 429/5xx 指数退避重试
 * - finish_reason=length 截断续写
 * - 思考标签剥离、JSON 鲁棒抽取
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
  /** 流式回调（收到增量文本） */
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

    const res = await this.request(this.endpoint('/chat/completions'), body, options.signal);
    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      return this.consumeSse(res, options, started);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }, finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    let text = json.choices?.[0]?.message?.content ?? '';
    const usage = json.usage ?? {};
    let promptTokens = usage.prompt_tokens ?? 0;
    let completionTokens = usage.completion_tokens ?? 0;

    let finish = json.choices?.[0]?.finish_reason;
    let continues = 0;
    const maxCont = options.maxContinues ?? 0;
    while (finish === 'length' && continues < maxCont && !options.signal?.aborted) {
      continues++;
      const cont = await this.request(this.endpoint('/chat/completions'), {
        ...body,
        stream: false,
        messages: [...options.messages, { role: 'assistant', content: text }, { role: 'user', content: '继续，从中断处直接接着写，不要重复、不要解释。' }],
      }, options.signal);
      const cj = (await cont.json()) as typeof json;
      const piece = cj.choices?.[0]?.message?.content ?? '';
      text += piece;
      finish = cj.choices?.[0]?.finish_reason;
      promptTokens += cj.usage?.prompt_tokens ?? 0;
      completionTokens += cj.usage?.completion_tokens ?? 0;
    }

    options.onDelta?.(text, text);
    return { text, promptTokens, completionTokens, ms: Date.now() - started };
  }

  private async consumeSse(res: Response, options: ChatOptions, started: number): Promise<ChatResult> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let finishReason: string | undefined;
    let promptTokens = 0;
    let completionTokens = 0;

    for (;;) {
      const { done, value } = await reader.read();
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
          };
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
        } catch { /* 跳过无法解析的行 */ }
      }
    }

    if (!completionTokens) completionTokens = roughTokens(full);
    if (!promptTokens) promptTokens = roughTokens(options.messages.map((m) => m.content).join('\n'));

    // 流式截断续写
    if (finishReason === 'length' && (options.maxContinues ?? 0) > 0 && !options.signal?.aborted) {
      const savedStream = options.onDelta;
      const cont = await this.chatOnce({ ...options, onDelta: undefined, streamContinueFor: full } as ChatOptions & { streamContinueFor?: string }, started).catch(() => undefined);
      if (cont) {
        full += cont.text;
        savedStream?.(cont.text, full);
        promptTokens += cont.promptTokens;
        completionTokens += cont.completionTokens;
      }
    }

    return { text: full, promptTokens, completionTokens, ms: Date.now() - started };
  }

  private async request(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new LlmError(`网络请求失败：${(e as Error).message}`, undefined, true);
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch { /* ignore */ }
    throw new LlmError(`API 错误 ${res.status}：${detail || res.statusText}`, res.status, retryable);
  }

  /** 一键测连：拉取模型列表或发一条最小消息 */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      if (res.ok) return { ok: true, message: '连接成功' };
      if (res.status === 404) {
        // 部分兼容服务没有 /models，用最小 chat 探测
        const r = await this.chat({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 5, retries: 0 });
        return { ok: true, message: `连接成功（模型响应 ${r.ms}ms）` };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 拉取模型列表 */
  async listModels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
    });
    if (!res.ok) throw new LlmError(`拉取模型列表失败：HTTP ${res.status}`, res.status);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
  }

  /** JSON 模式便捷方法 */
  async chatJson<T>(options: Omit<ChatOptions, 'jsonMode'>): Promise<T> {
    const result = await this.chat({ ...options, jsonMode: true });
    return extractJson<T>(result.text);
  }
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
