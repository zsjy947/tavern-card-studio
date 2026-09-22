/** 数据层入口：按运行环境自动选择驱动 */
import type { DataStore } from './store';
import { MemoryStore } from './drivers';
import { IndexedDbStore } from './indexeddb';
import { TauriSqlStore, isTauri } from './tauri';

let store: DataStore | undefined;

export async function getStore(): Promise<DataStore> {
  if (store) return store;
  if (isTauri()) {
    try {
      store = new TauriSqlStore();
      // 触发初始化
      await (store as TauriSqlStore).list('settings');
      return store;
    } catch (e) {
      console.warn('Tauri SQLite 初始化失败，回退 IndexedDB：', e);
    }
  }
  if (typeof indexedDB !== 'undefined') {
    store = new IndexedDbStore();
    return store;
  }
  store = new MemoryStore();
  return store;
}

/** 测试注入 */
export function setStore(s: DataStore): void {
  store = s;
}

export * from './store';
