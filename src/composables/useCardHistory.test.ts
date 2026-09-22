import { describe, it, expect, vi } from 'vitest';
import { useCardHistory } from './useCardHistory';

interface Obj { v: number }

function flushDebounce(ms = 600): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('useCardHistory', () => {
  it('节流入栈：停顿后才可撤销', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    expect(h.canUndo.value).toBe(false);
    h.commit({ v: 2 });
    expect(h.canUndo.value).toBe(false); // 未到 500ms
    await flushDebounce();
    expect(h.canUndo.value).toBe(true);
  });

  it('undo/redo 往返', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    h.commit({ v: 2 });
    await flushDebounce();
    h.commit({ v: 3 });
    await flushDebounce();
    const back1 = h.undo();
    expect(back1?.v).toBe(2);
    const back2 = h.undo();
    expect(back2?.v).toBe(1);
    expect(h.canUndo.value).toBe(false);
    const fwd = h.redo();
    expect(fwd?.v).toBe(2);
  });

  it('新编辑清空重做栈', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    h.commit({ v: 2 });
    await flushDebounce();
    h.undo();
    expect(h.canRedo.value).toBe(true);
    h.commit({ v: 99 });
    await flushDebounce();
    expect(h.canRedo.value).toBe(false);
  });

  it('无变化不入栈', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    h.commit({ v: 1 });
    await flushDebounce();
    expect(h.canUndo.value).toBe(false);
  });

  it('reset 清栈（保存后）', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    h.commit({ v: 2 });
    await flushDebounce();
    expect(h.canUndo.value).toBe(true);
    h.reset({ v: 5 });
    expect(h.canUndo.value).toBe(false);
    expect(h.canRedo.value).toBe(false);
  });

  it('快照上限 50', () => {
    vi.useFakeTimers();
    try {
      const h = useCardHistory<Obj>({ v: 0 });
      for (let i = 1; i <= 60; i++) {
        h.commit({ v: i });
        vi.advanceTimersByTime(600);
      }
      let undone = 0;
      let firstValue: number | null = null;
      while (h.canUndo.value) {
        const r = h.undo();
        if (r) firstValue = r.v;
        undone++;
      }
      expect(undone).toBe(50);
      // 最早的撤销结果是第 10 版（第 1-9 版被挤出）
      expect(firstValue).toBe(10);
      expect(h.undo()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bindHotkeys 应用回调', async () => {
    const h = useCardHistory<Obj>({ v: 1 });
    h.commit({ v: 2 });
    await flushDebounce();
    const applied: Obj[] = [];
    const fakeWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    h.bindHotkeys(fakeWindow, (v) => applied.push(v));
    expect(fakeWindow.addEventListener).toHaveBeenCalled();
    const handler = (fakeWindow.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (e: KeyboardEvent) => void;
    handler({ ctrlKey: true, key: 'z', preventDefault: () => {} } as unknown as KeyboardEvent);
    expect(applied[0]?.v).toBe(1);
  });
});
