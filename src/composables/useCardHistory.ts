/**
 * 编辑器本地撤销/重做（优化文档 P0-2）：
 * - 深拷贝快照栈（上限 50），Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
 * - 节流入栈：输入停顿 500ms 才推快照，避免每键一帧
 * - 仅作用于未保存的编辑态；保存后 reset（版本历史接管回滚）
 */
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';

export interface CardHistory<T> {
  canUndo: ReturnType<typeof ref<boolean>>;
  canRedo: ReturnType<typeof ref<boolean>>;
  /** 初始化/外部重置（加载、保存后） */
  reset(value: T): void;
  /** 节流推入快照（编辑中调用） */
  commit(value: T): void;
  undo(): T | null;
  redo(): T | null;
  /** 挂载全局快捷键；apply 负责把撤销/重做结果写回视图状态 */
  bindHotkeys(target: Window, apply: (v: T) => void): void;
  unbindHotkeys(): void;
}

const MAX_SNAPSHOTS = 50;
const COMMIT_DEBOUNCE_MS = 500;

export function useCardHistory<T extends object>(initial: T): CardHistory<T> {
  const undoStack = shallowRef<T[]>([]);
  const redoStack = shallowRef<T[]>([]);
  const canUndo = ref(false);
  const canRedo = ref(false);
  let current: T | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: T | null = null;
  let hotkeyTarget: Window | null = null;
  let applyFn: ((v: T) => void) | null = null;

  function syncFlags() {
    canUndo.value = undoStack.value.length > 0;
    canRedo.value = redoStack.value.length > 0;
  }

  function clone(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
  }

  function reset(value: T) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    pendingValue = null;
    undoStack.value = [];
    redoStack.value = [];
    current = clone(value);
    syncFlags();
  }

  /** 把节流中的待提交快照立即落栈（撤销前必须调用，否则最近的编辑会丢） */
  function flushPending() {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    const value = pendingValue;
    pendingValue = null;
    if (!value || !current) return;
    if (JSON.stringify(current) === JSON.stringify(value)) return;
    undoStack.value.push(current);
    if (undoStack.value.length > MAX_SNAPSHOTS) undoStack.value.shift();
    redoStack.value = [];
    current = clone(value);
    syncFlags();
  }

  function commit(value: T) {
    pendingValue = clone(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    // 到点直接走 flushPending（它负责置空 debounceTimer 并落栈）
    debounceTimer = setTimeout(flushPending, COMMIT_DEBOUNCE_MS);
  }

  function undo(): T | null {
    flushPending();
    const prev = undoStack.value.pop();
    if (!prev || !current) return null;
    redoStack.value.push(current);
    current = prev;
    syncFlags();
    return clone(current);
  }

  function redo(): T | null {
    flushPending();
    const next = redoStack.value.pop();
    if (!next || !current) return null;
    undoStack.value.push(current);
    current = next;
    syncFlags();
    return clone(current);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    let restored: T | null = null;
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      restored = undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      restored = redo();
    }
    if (restored && applyFn) applyFn(restored);
  }

  function bindHotkeys(target: Window, apply: (v: T) => void) {
    hotkeyTarget = target;
    applyFn = apply;
    target.addEventListener('keydown', onKeydown);
  }

  function unbindHotkeys() {
    if (hotkeyTarget) hotkeyTarget.removeEventListener('keydown', onKeydown);
    hotkeyTarget = null;
  }

  reset(initial);

  return { canUndo, canRedo, reset, commit, undo, redo, bindHotkeys, unbindHotkeys };
}
