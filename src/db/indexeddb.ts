/** IndexedDB 驱动（浏览器模式兜底） */
import { DEFAULT_PAGE_LIMIT, type DataStore } from './store';

const DB_NAME = 'tavern-card-studio';
// v2：新增 fonts / font_blobs（已装字体元信息与字节）
const DB_VERSION = 2;

export class IndexedDbStore implements DataStore {
  readonly kind = 'indexeddb' as const;
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // 表（object store）按需在升级时创建；已知表全部预建
        for (const t of ['cards', 'card_versions', 'templates', 'skills', 'ai_channels', 'ai_usage_logs', 'novel_projects', 'settings', 'categories', 'fonts', 'font_blobs', '__meta']) {
          if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx<T>(table: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db;
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(table, mode);
      const store = tx.objectStore(table);
      const req = fn(store);
      tx.oncomplete = () => resolve((req as IDBRequest<T> | undefined)?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get<T>(table: string, id: string): Promise<T | undefined> {
    const hit = await this.tx<{ id: string; value: T } | undefined>(table, 'readonly', (s) => s.get(id));
    return hit?.value;
  }

  async list<T>(table: string): Promise<T[]> {
    const rows = (await this.tx<{ id: string; value: T }[]>(table, 'readonly', (s) => s.getAll() as IDBRequest<{ id: string; value: T }[]>)) ?? [];
    return rows.map((r) => r.value);
  }

  /** IDBCursor keyset 分页（id 升序） */
  async listPage<T>(table: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ rows: T[]; nextCursor: string | null }> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readonly');
      const store = tx.objectStore(table);
      const range = opts.cursor ? IDBKeyRange.lowerBound(opts.cursor, true) : undefined;
      const rows: T[] = [];
      let lastId: string | null = null;
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || rows.length >= limit) {
          resolve({ rows, nextCursor: cursor ? lastId : null });
          return;
        }
        const row = cursor.value as { id: string; value: T };
        rows.push(row.value);
        lastId = row.id;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put<T>(table: string, id: string, value: T): Promise<void> {
    await this.tx(table, 'readwrite', (s) => s.put({ id, value }));
  }

  async bulkPut<T>(table: string, entries: { id: string; value: T }[]): Promise<void> {
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      for (const e of entries) store.put({ id: e.id, value: e.value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 单个 readwrite 事务内 clear + put：中途任何一步失败整事务回滚（F2 原子替换） */
  async replaceAll<T>(table: string, entries: { id: string; value: T }[]): Promise<void> {
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      store.clear();
      for (const e of entries) store.put({ id: e.id, value: e.value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async delete(table: string, id: string): Promise<void> {
    await this.tx(table, 'readwrite', (s) => s.delete(id));
  }

  async clear(table: string): Promise<void> {
    await this.tx(table, 'readwrite', (s) => s.clear());
  }

  async dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    const db = await this.db;
    for (const name of db.objectStoreNames) {
      if (name === '__meta') continue;
      out[name] = await this.list(name);
    }
    return out;
  }
}
