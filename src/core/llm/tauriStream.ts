/**
 * Tauri 流式代理适配器：把 Rust llm_post_stream 的 Channel 事件
 * 合成为带 ReadableStream 的标准 Response，供 LlmClient 的 fetch 接缝注入。
 * 事件序：headers → chunk* → done | error；abort/reader.cancel 触发 llm_cancel_stream。
 * 契约：事件字段为 camelCase（Rust 侧 rename_all_fields，见 llm.rs 序列化单测）。
 */
import { isTauri, tauriInvoke } from '@/db/tauri';
import { base64ToBytes } from '@/utils/file';

interface TauriStreamEvent {
  event: 'headers' | 'chunk' | 'done' | 'error';
  status?: number;
  contentType?: string;
  bytesB64?: string;
  message?: string;
}

interface TauriCoreWithChannel {
  core: {
    invoke: ReturnType<typeof tauriInvoke>;
    Channel: new <T>() => { onmessage: ((msg: T) => void) | null };
  };
}

/** 桌面端专用 fetch：透传 method/headers/body/signal，流式回传响应体 */
export function tauriStreamFetch(): typeof fetch {
  const core = (window as unknown as { __TAURI__?: TauriCoreWithChannel }).__TAURI__;
  if (!core?.core?.Channel) throw new Error('window.__TAURI__.core.Channel 不可用');
  const invoke = core.core.invoke;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const signal = init?.signal ?? null;
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const hasBody = init?.body != null && method !== 'GET' && method !== 'HEAD';
    const body = hasBody ? String(init!.body) : '';

    const sessionId = `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    let status = 0;
    let contentType = '';
    let failure: Error | undefined;
    let startNotify: (() => void) | undefined;
    const startReady = new Promise<void>((resolve) => {
      startNotify = resolve;
    });
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) failure = err;
      startNotify?.();
    };

    const onAbort = () => {
      const err = new DOMException('请求已取消', 'AbortError');
      void invoke('llm_cancel_stream', { sessionId }).catch(() => undefined);
      settle(err);
      try { controllerRef?.error(err); } catch { /* 流已关闭 */ }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        const channel = new core.core.Channel<TauriStreamEvent>();
        channel.onmessage = (evt) => {
          try {
            if (evt.event === 'headers') {
              status = evt.status ?? 0;
              contentType = evt.contentType ?? '';
              settle();
            } else if (evt.event === 'chunk') {
              if (evt.bytesB64) controller.enqueue(base64ToBytes(evt.bytesB64));
            } else if (evt.event === 'done') {
              signal?.removeEventListener('abort', onAbort);
              settle();
              controller.close();
            } else if (evt.event === 'error') {
              signal?.removeEventListener('abort', onAbort);
              settle(new Error(evt.message ?? '流式读取失败'));
              controller.error(new Error(evt.message ?? '流式读取失败'));
            }
          } catch (e) {
            // enqueue 在流被取消后抛错属正常竞态，忽略
          }
        };
        void invoke('llm_post_stream', { url, method, headers, body, sessionId, onChunk: channel }).catch((e: Error) => {
          signal?.removeEventListener('abort', onAbort);
          settle(new Error(`流式代理调用失败：${e.message}`));
          try { controller.error(new Error(`流式代理调用失败：${e.message}`)); } catch { /* 已关闭 */ }
        });
      },
      cancel() {
        signal?.removeEventListener('abort', onAbort);
        void invoke('llm_cancel_stream', { sessionId }).catch(() => undefined);
      },
    });

    await startReady;
    signal?.removeEventListener('abort', onAbort);
    // 建连/代理层失败：抛真实错误（不能构造 status=0 的 Response，会抛 RangeError）
    if (failure && status === 0) throw failure;
    if (status === 0) throw new Error('连接失败：服务器无响应');

    return new Response(stream, {
      status,
      headers: contentType ? { 'content-type': contentType } : undefined,
    });
  }) as typeof fetch;
}

/** 桌面端返回流式代理 fetch，浏览器端返回原生 fetch */
export function fetchImplForPlatform(): typeof fetch {
  return isTauri() ? tauriStreamFetch() : globalThis.fetch.bind(globalThis);
}
