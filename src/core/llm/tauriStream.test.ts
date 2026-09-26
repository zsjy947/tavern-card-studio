// @vitest-environment happy-dom
/**
 * tauriStream 单测（技术债 D5）：mock window.__TAURI__ 驱动 Channel 事件。
 * 覆盖：error 先于 headers、done 正常收束、abort 触发 llm_cancel_stream、signal 桥接。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { tauriStreamFetch } from './tauriStream';

interface FakeChannel {
  onmessage: ((msg: unknown) => void) | null;
}

type Drive = (channel: FakeChannel) => void;

function installTauri(drive: Drive, onCancel?: () => void) {
  let latest: FakeChannel | null = null;
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'llm_post_stream') {
      latest = args?.onChunk as FakeChannel;
      drive(latest);
      return null;
    }
    if (cmd === 'llm_cancel_stream') {
      onCancel?.();
      return null;
    }
    return null;
  });
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke,
      Channel: class implements FakeChannel {
        onmessage: ((msg: unknown) => void) | null = null;
        constructor() {
          latest = this;
        }
      },
    },
  };
  return { invoke };
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe('tauriStream', () => {
  it('error 先于 headers：fetch 拒绝并携带错误信息', async () => {
    installTauri((channel) => {
      channel.onmessage?.({ event: 'error', message: 'boom before headers' });
    });
    const fetcher = tauriStreamFetch();
    await expect(fetcher('https://api.example.com/v1', { method: 'POST', body: '{}' })).rejects.toThrow('boom before headers');
  });

  it('headers → chunk → done：合成 Response 正常读取文本', async () => {
    installTauri((channel) => {
      queueMicrotask(() => {
        channel.onmessage?.({ event: 'headers', status: 200, contentType: 'text/event-stream' });
        channel.onmessage?.({ event: 'chunk', bytesB64: btoa('hello ') });
        channel.onmessage?.({ event: 'chunk', bytesB64: btoa('world') });
        channel.onmessage?.({ event: 'done' });
      });
    });
    const fetcher = tauriStreamFetch();
    const resp = await fetcher('https://api.example.com/v1', { method: 'POST', body: '{}' });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('text/event-stream');
    await expect(resp.text()).resolves.toBe('hello world');
  });

  it('AbortSignal：headers 前中断→抛 AbortError 并触发 llm_cancel_stream', async () => {
    let cancelCalled = false;
    // invoke 挂起且不回 headers（模拟建连期）
    installTauri(
      () => undefined,
      () => {
        cancelCalled = true;
      },
    );
    const controller = new AbortController();
    const fetcher = tauriStreamFetch();
    const p = fetcher('https://api.example.com/v1', { method: 'POST', body: '{}', signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow('请求已取消');
    expect(cancelCalled).toBe(true);
  });

  it('headers 后经 reader.cancel 中断：同样触发 llm_cancel_stream', async () => {
    let cancelCalled = false;
    installTauri(
      (channel) => {
        queueMicrotask(() => {
          channel.onmessage?.({ event: 'headers', status: 200, contentType: 'text/event-stream' });
          // 不发 done：模拟长流
        });
      },
      () => {
        cancelCalled = true;
      },
    );
    const fetcher = tauriStreamFetch();
    const resp = await fetcher('https://api.example.com/v1', { method: 'POST', body: '{}' });
    const reader = resp.body!.getReader();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelCalled).toBe(true);
  });

  it('signal 已在 abort 状态时直接抛 AbortError，不发请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const { invoke } = installTauri(() => undefined);
    const fetcher = tauriStreamFetch();
    await expect(
      fetcher('https://api.example.com/v1', { method: 'POST', body: '{}', signal: controller.signal }),
    ).rejects.toThrow('请求已取消');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invoke 本身失败：抛「流式代理调用失败」', async () => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: vi.fn(async () => {
          throw new Error('invoke down');
        }),
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
        },
      },
    };
    const fetcher = tauriStreamFetch();
    await expect(fetcher('https://api.example.com/v1', { method: 'POST', body: '{}' })).rejects.toThrow('流式代理调用失败');
  });
});
