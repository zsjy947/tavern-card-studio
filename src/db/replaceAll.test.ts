// @vitest-environment happy-dom
/**
 * replaceAll 原子全量替换单测（F2/TCS-R2-01）：
 * - MemoryStore：旧数据被替换、新数据完整；
 * - IndexedDbStore：clear + 全部 put 落在同一个 readwrite 事务（伪 IDB 捕获调用序列）；
 * - TauriSqlStore：BEGIN IMMEDIATE → DELETE → 逐行 upsert → COMMIT，失败 ROLLBACK 不留 COMMIT；
 * - importBackup：坏行（无 id / id 非字符串）被过滤并计入 skipped，wipe 走 replaceAll、合并走 bulkPut。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './drivers';
import { IndexedDbStore } from './indexeddb';
import { TauriSqlStore } from './tauri';
import type { DataStore } from './store';
import { setStore } from './index';
import { importBackup } from '@/services/backupService';
import JSZip from 'jszip';

/* ---------------- MemoryStore：替换语义 ---------------- */

describe('MemoryStore.replaceAll', () => {
  it('旧数据被替换、新数据完整', async () => {
    const s = new MemoryStore();
    await s.bulkPut('cards', [
      { id: 'old1', value: { v: 1 } },
      { id: 'old2', value: { v: 2 } },
    ]);
    await s.replaceAll('cards', [
      { id: 'n1', value: { v: 3 } },
      { id: 'n2', value: { v: 4 } },
      { id: 'n3', value: { v: 5 } },
    ]);
    const rows = (await s.list<{ v: number }>('cards')).map((r) => r.v).sort();
    expect(rows).toEqual([3, 4, 5]);
  });

  it('空清单替换后表为空', async () => {
    const s = new MemoryStore();
    await s.put('cards', 'x', { v: 1 });
    await s.replaceAll('cards', []);
    expect(await s.list('cards')).toEqual([]);
  });
});

/* ---------------- IndexedDbStore：单事务 clear+put ---------------- */

/** 伪 IndexedDB：只实现 IndexedDbStore 用到的 open/transaction/get/getAll/put/clear/delete，记录每个事务的操作序列 */
function installFakeIdb() {
  const txs: { name: string; mode: string; ops: string[] }[] = [];
  const records = new Map<string, Map<string, unknown>>();
  const names = new Set<string>();

  class FakeRequest<T> {
    result: T | undefined;
    constructor(result?: T) {
      this.result = result;
    }
  }

  const db = {
    objectStoreNames: { contains: (t: string) => names.has(t) },
    createObjectStore(t: string) {
      names.add(t);
      records.set(t, new Map());
    },
    transaction(name: string, mode: string) {
      const tx = { name, mode, ops: [] as string[] };
      txs.push(tx);
      const rec = records.get(name)!;
      setTimeout(() => handlers.oncomplete?.(), 0);
      const handlers: { oncomplete: (() => void) | null } = { oncomplete: null };
      return {
        objectStore: () => ({
          get: (id: string) => new FakeRequest(rec.get(id)),
          getAll: () => new FakeRequest([...rec.values()]),
          put: (v: { id: string }) => {
            rec.set(v.id, v);
            tx.ops.push(`put:${v.id}`);
          },
          clear: () => {
            rec.clear();
            tx.ops.push('clear');
          },
          delete: (id: string) => {
            rec.delete(id);
            tx.ops.push(`delete:${id}`);
          },
        }),
        set oncomplete(fn: (() => void) | null) {
          handlers.oncomplete = fn;
        },
        get oncomplete() {
          return handlers.oncomplete;
        },
        onerror: null,
        onabort: null,
        error: null,
      };
    },
  };

  const openReq = {
    result: db,
    onupgradeneeded: null as (() => void) | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    error: null,
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => {
        openReq.onupgradeneeded?.();
        openReq.onsuccess?.();
      });
      return openReq;
    },
  });
  return { txs };
}

describe('IndexedDbStore.replaceAll', () => {
  it('clear 与全部 put 在同一个 readwrite 事务内（原子性），数据完整替换', async () => {
    const { txs } = installFakeIdb();
    const s = new IndexedDbStore();
    await s.bulkPut('cards', [
      { id: 'old1', value: { v: 1 } },
      { id: 'old2', value: { v: 2 } },
    ]);
    txs.length = 0;

    await s.replaceAll('cards', [
      { id: 'n1', value: { v: 3 } },
      { id: 'n2', value: { v: 4 } },
    ]);

    // 只开了一个事务，且 clear 与两个 put 都在其中——IDB 语义下失败即整体回滚
    expect(txs).toHaveLength(1);
    expect(txs[0]!.mode).toBe('readwrite');
    expect(txs[0]!.ops).toEqual(['clear', 'put:n1', 'put:n2']);

    const rows = (await s.list<{ v: number }>('cards')).map((r) => r.v).sort();
    expect(rows).toEqual([3, 4]);
  });
});

/* ---------------- TauriSqlStore：显式事务 ---------------- */

describe('TauriSqlStore.replaceAll', () => {
  let queries: string[];
  let failOnInsert: boolean;

  beforeEach(() => {
    queries = [];
    failOnInsert = false;
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'plugin:sql|execute') {
            const q = String(args?.query);
            queries.push(q);
            if (failOnInsert && q.startsWith('INSERT')) throw new Error('sqlite: disk error');
          }
          if (cmd === 'db_url') return 'sqlite:test.db';
          return [];
        },
      },
    };
  });

  async function freshStore(): Promise<TauriSqlStore> {
    const s = new TauriSqlStore();
    await s.list('settings'); // 等待初始化完成
    queries.length = 0;
    return s;
  }

  it('BEGIN IMMEDIATE → DELETE → 逐行 upsert → COMMIT', async () => {
    const s = await freshStore();
    await s.replaceAll('cards', [
      { id: 'n1', value: { v: 1 } },
      { id: 'n2', value: { v: 2 } },
    ]);
    expect(queries[0]).toBe('BEGIN IMMEDIATE');
    expect(queries[1]).toBe('DELETE FROM cards');
    expect(queries.filter((q) => q.startsWith('INSERT INTO cards'))).toHaveLength(2);
    expect(queries[queries.length - 1]).toBe('COMMIT');
  });

  it('中途失败：ROLLBACK 且无 COMMIT（库保持旧数据）', async () => {
    const s = await freshStore();
    failOnInsert = true;
    await expect(
      s.replaceAll('cards', [
        { id: 'n1', value: { v: 1 } },
        { id: 'n2', value: { v: 2 } },
      ]),
    ).rejects.toThrow('sqlite: disk error');
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });
});

/* ---------------- importBackup：坏行过滤 + skipped 计数 ---------------- */

/** 记录调用序列的 mock store（不落数据，只关心分派） */
function recordingStore() {
  const ops: { op: string; table: string; count: number }[] = [];
  const store: DataStore = {
    kind: 'memory',
    get: async () => undefined,
    list: async () => [],
    listPage: async () => ({ rows: [], nextCursor: null }),
    put: async () => undefined,
    bulkPut: async (table, entries) => {
      ops.push({ op: 'bulkPut', table, count: entries.length });
    },
    replaceAll: async (table, entries) => {
      ops.push({ op: 'replaceAll', table, count: entries.length });
    },
    delete: async () => undefined,
    clear: async () => undefined,
    dump: async () => ({}),
  };
  return { store, ops };
}

async function buildBackupZip(cardsJson: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ app: 'tavern-card-studio', version: 1, tables: {} }));
  zip.file('tables/cards.json', cardsJson);
  return zip.generateAsync({ type: 'blob' });
}

describe('importBackup 行校验（F2）', () => {
  const badRows = JSON.stringify([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { no: 1 }, // 无 id
    null, // null
    { id: '' }, // 空 id
    { id: 42 }, // id 非字符串
  ]);

  it('wipe 走 replaceAll，坏行被过滤且 skipped 计数正确', async () => {
    const { store, ops } = recordingStore();
    setStore(store);
    const r = await importBackup(await buildBackupZip(badRows), { wipe: true });
    expect(ops).toEqual([{ op: 'replaceAll', table: 'cards', count: 2 }]);
    expect(r.tables.cards).toBe(2);
    expect(r.skipped.cards).toBe(4);
  });

  it('合并模式仍走 bulkPut，同样过滤坏行', async () => {
    const { store, ops } = recordingStore();
    setStore(store);
    const r = await importBackup(await buildBackupZip(badRows), { wipe: false });
    expect(ops).toEqual([{ op: 'bulkPut', table: 'cards', count: 2 }]);
    expect(r.tables.cards).toBe(2);
    expect(r.skipped.cards).toBe(4);
  });

  it('未知表名被白名单拒绝，不透传到 SQL（表名注入防御）', async () => {
    const { store, ops } = recordingStore();
    setStore(store);
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ app: 'tavern-card-studio', version: 1, tables: {} }));
    zip.file('tables/cards; COMMIT; SELECT load_extension(\'x\') --.json', '[]');
    await expect(importBackup(await zip.generateAsync({ type: 'blob' }), { wipe: true })).rejects.toThrow('未知表');
    expect(ops).toEqual([]); // 未触达任何 store 调用
  });

  it('排除表（fonts）同样被拒绝导入', async () => {
    const { store, ops } = recordingStore();
    setStore(store);
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ app: 'tavern-card-studio', version: 1, tables: {} }));
    zip.file('tables/fonts.json', '[]');
    await expect(importBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('未知表');
    expect(ops).toEqual([]);
  });

  it('全部合法时 skipped 为空对象', async () => {
    const { store } = recordingStore();
    setStore(store);
    const r = await importBackup(await buildBackupZip(JSON.stringify([{ id: 'a' }, { id: 'b' }])), { wipe: true });
    expect(r.tables.cards).toBe(2);
    expect(r.skipped).toEqual({});
  });
});
