// @vitest-environment happy-dom
/**
 * pickFiles 兜底路径单测（技术债 D5）：
 * change 事件正常回传文件；cancel 事件取消；focus 宽限期后无 change 判定为取消。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { pickFiles } from './file';

function lastFileInput(): HTMLInputElement {
  const inputs = document.body.querySelectorAll('input[type="file"]');
  const last = inputs[inputs.length - 1] as HTMLInputElement | undefined;
  if (!last) throw new Error('未找到 file input');
  return last;
}

describe('pickFiles', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('change 事件：带文件 resolve', async () => {
    const p = pickFiles('.txt', false);
    const input = lastFileInput();
    expect(input.accept).toBe('.txt');
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await expect(p).resolves.toHaveLength(1);
  });

  it('oncancel：resolve 空数组', async () => {
    const p = pickFiles('.json', false);
    const input = lastFileInput();
    input.dispatchEvent(new Event('cancel'));
    await expect(p).resolves.toHaveLength(0);
  });

  it('focus 宽限期（800ms）内无 change：按取消处理', async () => {
    vi.useFakeTimers();
    const p = pickFiles('.txt', false);
    window.dispatchEvent(new Event('focus'));
    // 宽限期内：未决
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(700);
    expect(settled).toBe(false);
    // 宽限期结束：判取消
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toHaveLength(0);
  });

  it('宽限期内来 change：按文件回传', async () => {
    vi.useFakeTimers();
    const p = pickFiles('.txt', false);
    window.dispatchEvent(new Event('focus'));
    const input = lastFileInput();
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.txt')] });
    input.dispatchEvent(new Event('change'));
    await expect(p).resolves.toHaveLength(1);
  });
});
