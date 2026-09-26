// @vitest-environment happy-dom
/**
 * getStore 失败重试单测（技术债 D7）：
 * initStore 意外 reject 时清空 storePromise，后续 getStore 可重新初始化成功。
 * （无修复时 rejected promise 被永久缓存，第二次调用直接复现旧错误。）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = { failIdb: true };

vi.mock('./tauri', () => ({ isTauri: () => false, TauriSqlStore: class {} }));
vi.mock('./indexeddb', () => ({
  IndexedDbStore: class {
    kind = 'indexeddb' as const;
    constructor() {
      if (state.failIdb) throw new Error('idb down');
    }
    async list() {
      return [];
    }
  },
}));
vi.mock('./drivers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./drivers')>();
  return mod;
});

// happy-dom 提供 indexedDB? 测试显式置位以覆盖「typeof indexedDB !== 'undefined'」分支
beforeEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
  state.failIdb = true;
});

import { getStore } from './index';

describe('getStore 初始化失败重试（D7）', () => {
  it('首次失败后再次调用可成功获取驱动', async () => {
    // 首次：IndexedDB 构造抛错 → getStore reject
    await expect(getStore()).rejects.toThrow('idb down');
    // 故障恢复
    state.failIdb = false;
    // 第二次：重新初始化成功（修复前：永久缓存 rejected promise，必失败）
    const store = await getStore();
    expect(store.kind).toBe('indexeddb');
  });
});
