/** 数据层入口：按运行环境自动选择驱动 */
import type { DataStore } from './store';
import { MemoryStore } from './drivers';
import { IndexedDbStore } from './indexeddb';
import { TauriSqlStore, isTauri } from './tauri';

let storePromise: Promise<DataStore> | undefined;
let degradedError: string | null = null;

/** 已知业务表（迁移用；不含 __meta） */
const MIGRATE_TABLES = [
  'cards', 'card_versions', 'templates', 'skills', 'ai_channels',
  'ai_usage_logs', 'novel_projects', 'settings', 'categories', 'fonts', 'font_blobs',
];

/**
 * 并发安全：启动期多处同时 getStore() 只初始化一次驱动，
 * 避免两个 TauriSqlStore 并发 load/CREATE TABLE 打同一个 SQLite 导致瞬时失败。
 * SQLite 初始化最多重试 3 次（带退避），仍失败才降级 IndexedDB 并记录真实错误。
 * 失败不缓存：initStore 意外 reject 时清空 storePromise 允许后续调用重试（技术债 D7）。
 */
export async function getStore(): Promise<DataStore> {
  if (!storePromise) storePromise = initStore();
  const current = storePromise;
  try {
    return await current;
  } catch (e) {
    if (storePromise === current) storePromise = undefined;
    throw e;
  }
}

async function initStore(): Promise<DataStore> {
  if (isTauri()) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const s = new TauriSqlStore();
        await s.list('settings');
        await migrateIdbToSqliteOnce(s);
        return s;
      } catch (e) {
        lastError = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
      }
    }
    console.warn('Tauri SQLite 初始化失败，回退 IndexedDB：', lastError);
    degradedError = lastError instanceof Error ? lastError.message : String(lastError);
  }
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbStore();
  }
  return new MemoryStore();
}

/**
 * 一次性迁移：历史版本打包应用存在 SQLite 写入 bug（execute/select 参数名错传 params），
 * 桌面端一直静默降级 IndexedDB，用户数据留在 IndexedDB。修复后首个启动把
 * IndexedDB 现有数据按 id 合并进 SQLite（只补缺失行，不覆盖），并打标记防重跑。
 */
async function migrateIdbToSqliteOnce(sqlite: TauriSqlStore): Promise<void> {
  const marker = await sqlite.get<{ id: string; value: boolean }>('settings', 'sqlite_migrated_v1');
  if (marker?.value) return;
  try {
    if (typeof indexedDB !== 'undefined') {
      const idb = new IndexedDbStore();
      for (const table of MIGRATE_TABLES) {
        const rows = await idb.list(table);
        if (!rows.length) continue;
        const existing = new Set((await sqlite.list(table)).map((r) => (r as { id: string }).id));
        const missing = rows
          .map((value) => ({ id: String((value as { id: string }).id), value }))
          .filter((e) => !existing.has(e.id));
        if (missing.length) await sqlite.bulkPut(table, missing);
      }
    }
    await sqlite.put('settings', 'sqlite_migrated_v1', { id: 'sqlite_migrated_v1', value: true });
  } catch (e) {
    // 迁移失败不阻塞启动：SQLite 仍可用（空库），下次启动重试
    console.warn('IndexedDB → SQLite 一次性迁移失败（下次启动重试）：', e);
  }
}

/**
 * 桌面 SQLite 降级到 IndexedDB 的一次性通知（消费后复位）。
 * 返回初始化失败的真实错误信息，便于用户反馈与排查。
 */
export function consumeDegradedNotice(): string | null {
  const err = degradedError;
  degradedError = null;
  return err;
}

/** 测试注入 */
export function setStore(s: DataStore): void {
  storePromise = Promise.resolve(s);
}

export * from './store';
