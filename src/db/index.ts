/** 数据层入口：按运行环境自动选择驱动 */
import type { DataStore } from './store';
import { MemoryStore } from './drivers';
import { IndexedDbStore } from './indexeddb';
import { TauriSqlStore, isTauri } from './tauri';

let storePromise: Promise<DataStore> | undefined;
let degradedNoticePending = false;

/**
 * 并发安全：启动期多处同时 getStore() 只初始化一次驱动，
 * 避免两个 TauriSqlStore 并发 load/CREATE TABLE 打同一个 SQLite 导致瞬时失败。
 */
export async function getStore(): Promise<DataStore> {
  if (!storePromise) storePromise = initStore();
  return storePromise;
}

async function initStore(): Promise<DataStore> {
  if (isTauri()) {
    // 瞬时失败自动重试一次，仍失败才降级
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const s = new TauriSqlStore();
        await s.list('settings');
        return s;
      } catch (e) {
        lastError = e;
      }
    }
    console.warn('Tauri SQLite 初始化失败，回退 IndexedDB：', lastError);
    degradedNoticePending = true;
  }
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbStore();
  }
  return new MemoryStore();
}

/** 桌面 SQLite 降级到 IndexedDB 的一次性提示（消费后复位） */
export function consumeDegradedNotice(): boolean {
  const pending = degradedNoticePending;
  degradedNoticePending = false;
  return pending;
}

/** 测试注入 */
export function setStore(s: DataStore): void {
  storePromise = Promise.resolve(s);
}

export * from './store';
