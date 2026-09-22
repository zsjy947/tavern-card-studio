/**
 * Tauri SQLite 驱动：通过 window.__TAURI__.core.invoke 调用 plugin:sql 命令，
 * 无需引入 @tauri-apps/plugin-sql JS 包（保持 web 构建零 Tauri 依赖）。
 */

import type { DataStore } from './store';

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriGlobal {
  core: { invoke: TauriInvoke };
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function tauriInvoke(): TauriInvoke {
  const g = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (!g?.core?.invoke) throw new Error('window.__TAURI__ 不可用（需要在 tauri.conf.json 开启 withGlobalTauri）');
  return g.core.invoke;
}

/** 数据库连接字符串：便携模式 ./data/studio.db（Rust 侧已切好工作目录） */
const DB_URL = 'sqlite:studio.db';

interface SqlRow {
  [k: string]: unknown;
}

export class TauriSqlStore implements DataStore {
  readonly kind = 'sqlite' as const;
  private ready: Promise<void>;

  constructor() {
    this.ready = (async () => {
      const invoke = tauriInvoke();
      await invoke('plugin:sql|load', { db: DB_URL });
      for (const t of ['cards', 'card_versions', 'templates', 'skills', 'ai_channels', 'ai_usage_logs', 'novel_projects', 'settings', 'categories']) {
        await invoke('plugin:sql|execute', {
          db: DB_URL,
          query: `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
          params: [],
        });
      }
    })();
  }

  private async exec(query: string, params: unknown[]): Promise<SqlRow[]> {
    await this.ready;
    const invoke = tauriInvoke();
    return (await invoke('plugin:sql|select', { db: DB_URL, query, params })) as SqlRow[];
  }

  private async run(query: string, params: unknown[]): Promise<void> {
    await this.ready;
    const invoke = tauriInvoke();
    await invoke('plugin:sql|execute', { db: DB_URL, query, params });
  }

  async get<T>(table: string, id: string): Promise<T | undefined> {
    const rows = await this.exec(`SELECT json FROM ${table} WHERE id = $1`, [id]);
    return rows[0] ? (JSON.parse(String(rows[0].json)) as T) : undefined;
  }

  async list<T>(table: string): Promise<T[]> {
    const rows = await this.exec(`SELECT json FROM ${table}`, []);
    return rows.map((r) => JSON.parse(String(r.json)) as T);
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

  async delete(table: string, id: string): Promise<void> {
    await this.run(`DELETE FROM ${table} WHERE id = $1`, [id]);
  }

  async clear(table: string): Promise<void> {
    await this.run(`DELETE FROM ${table}`, []);
  }

  async dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const t of ['cards', 'card_versions', 'templates', 'skills', 'ai_channels', 'ai_usage_logs', 'novel_projects', 'settings', 'categories']) {
      out[t] = await this.list(t);
    }
    return out;
  }
}
