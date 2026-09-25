/**
 * Tauri 流式代理适配器：把 Rust llm_post_stream 的 Channel 事件
 * 合成为带 ReadableStream 的标准 Response，供 LlmClient 的 fetch 接缝注入。
 * 事件序：headers → chunk* → done | error；Response.cancel 触发 llm_cancel_stream。
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

/** 桌面端专用 fetch：仅支持 POST + 字符串体（LLM chat/completions 场景足够） */
export function tauriStreamFetch(): typeof fetch {
  const core = (window as unknown as { __TAURI__?: TauriCoreWithChannel }).__TAURI__;
  if (!core?.core?.Channel) throw new Error('window.__TAURI__.core.Channel 不可用');
  const invoke = core.core.invoke;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init?.body === 'string' ? init.body : '';
    const sessionId = `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    let status = 0;
    let contentType = '';
    let startNotify: (() => void) | undefined;
    const startReady = new Promise<void>((resolve) => {
      startNotify = resolve;
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const channel = new core.core.Channel<TauriStreamEvent>();
        channel.onmessage = (evt) => {
          if (evt.event === 'headers') {
            status = evt.status ?? 0;
            contentType = evt.contentType ?? '';
            startNotify?.();
          } else if (evt.event === 'chunk') {
            if (evt.bytesB64) controller.enqueue(base64ToBytes(evt.bytesB64));
          } else if (evt.event === 'done') {
            startNotify?.();
            controller.close();
          } else if (evt.event === 'error') {
            startNotify?.();
            controller.error(new Error(evt.message ?? '流式读取失败'));
          }
        };
        void invoke('llm_post_stream', { url, headers, body, sessionId, onChunk: channel }).catch((e: Error) => {
          startNotify?.();
          controller.error(new Error(`流式代理调用失败：${e.message}`));
        });
      },
      cancel() {
        void invoke('llm_cancel_stream', { sessionId }).catch(() => undefined);
      },
    });

    await startReady;
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
