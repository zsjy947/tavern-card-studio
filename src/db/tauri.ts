/**
 * Tauri SQLite 驱动：通过 window.__TAURI__.core.invoke 调用 plugin:sql 命令
 * 与自定义 db_url 命令（便携优先：exe 同级 ./data/studio.db，失败回退 AppData）。
 */

import { DEFAULT_PAGE_LIMIT, type DataStore } from './store';

export interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriGlobal {
  core: { invoke: TauriInvoke };
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 全局 invoke（withGlobalTauri）；非 Tauri 环境调用会抛错 */
export function tauriInvoke(): TauriInvoke {
  const g = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (!g?.core?.invoke) throw new Error('window.__TAURI__ 不可用（需要在 tauri.conf.json 开启 withGlobalTauri）');
  return g.core.invoke;
}

interface SqlRow {
  [k: string]: unknown;
}

export class TauriSqlStore implements DataStore {
  readonly kind = 'sqlite' as const;
  private db: string | null = null;
  private ready: Promise<void>;

  constructor() {
    const invoke = tauriInvoke();
    // 连接串由 Rust 决定：便携绝对路径或相对（AppData）
    this.ready = (async () => {
      this.db = await invoke('db_url')
        .then((url) => String(url))
        .catch(() => 'sqlite:studio.db');
      await invoke('plugin:sql|load', { db: this.db });
      for (const t of ['cards', 'card_versions', 'templates', 'skills', 'ai_channels', 'ai_usage_logs', 'novel_projects', 'settings', 'categories', 'fonts', 'font_blobs']) {
        await invoke('plugin:sql|execute', {
          db: this.db,
          query: `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
          // 插件命令参数名是 values（与 exec/run 同因，见下）
          values: [],
        });
      }
    })();
  }

  private async exec(query: string, params: unknown[]): Promise<SqlRow[]> {
    await this.ready;
    // 注意：插件命令的参数名是 values（不是 params），错名会被 invoke 层直接拒绝
    return (await tauriInvoke()('plugin:sql|select', { db: this.db!, query, values: params })) as SqlRow[];
  }

  private async run(query: string, params: unknown[]): Promise<void> {
    await this.ready;
    await tauriInvoke()('plugin:sql|execute', { db: this.db!, query, values: params });
  }

  async get<T>(table: string, id: string): Promise<T | undefined> {
    const rows = await this.exec(`SELECT json FROM ${table} WHERE id = $1`, [id]);
    return rows[0] ? (JSON.parse(String(rows[0].json)) as T) : undefined;
  }

  async list<T>(table: string): Promise<T[]> {
    const rows = await this.exec(`SELECT json FROM ${table}`, []);
    return rows.map((r) => JSON.parse(String(r.json)) as T);
  }

  /** keyset 分页（id 升序，WHERE id > ? ORDER BY id LIMIT ? 下推 SQLite） */
  async listPage<T>(table: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ rows: T[]; nextCursor: string | null }> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = opts.cursor
      ? await this.exec(`SELECT id, json FROM ${table} WHERE id > $1 ORDER BY id LIMIT $2`, [opts.cursor, limit + 1])
      : await this.exec(`SELECT id, json FROM ${table} ORDER BY id LIMIT $1`, [limit + 1]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      rows: page.map((r) => JSON.parse(String(r.json)) as T),
      nextCursor: hasMore ? String(page[page.length - 1]!.id) : null,
    };
  }

  async put<T>(table: string, id: string, value: T): Promise<void> {
    await this.run(
      `INSERT INTO ${table} (id, json) VALUES ($1, $2) ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      [id, JSON.stringify(value)],
    );
  }

  async bulkPut<T>(table: string, entries: { id: string; value: T }[]): Promise<void> {
    for (const e of entries) await this.put(table, e.id, e.value);
  }

  /**
   * 原子全量替换（F2/TCS-R2-01）：显式事务 BEGIN IMMEDIATE → DELETE → 批量 upsert → COMMIT。
   * 中途任何一步失败 ROLLBACK，库保持导入前的旧数据（不会清空后落半截）。
   * 插件 execute 每次一条语句，事务跨多次 execute：本应用顺序 await、池内单连接，语句落在同一连接上。
   */
  async replaceAll<T>(table: string, entries: { id: string; value: T }[]): Promise<void> {
    await this.run('BEGIN IMMEDIATE', []);
    try {
      await this.run(`DELETE FROM ${table}`, []);
      for (const e of entries) await this.put(table, e.id, e.value);
      await this.run('COMMIT', []);
    } catch (e) {
      // 尽力回滚（回滚失败也优先抛原始错误）
      await this.run('ROLLBACK', []).catch(() => undefined);
      throw e;
    }
  }

  async delete(table: string, id: string): Promise<void> {
    await this.run(`DELETE FROM ${table} WHERE id = $1`, [id]);
  }

  async clear(table: string): Promise<void> {
    await this.run(`DELETE FROM ${table}`, []);
  }

  async dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const t of ['cards', 'card_versions', 'templates', 'skills', 'ai_channels', 'ai_usage_logs', 'novel_projects', 'settings', 'categories', 'fonts', 'font_blobs']) {
      out[t] = await this.list(t);
    }
    return out;
  }
}
