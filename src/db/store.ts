/**
 * 存储抽象：所有表通过 DataStore 读写（整对象 JSON 存取，本地规模完全够用）。
 *
 * 三种驱动：
 * - MemoryStore   —— 测试/SSR
 * - IndexedDbStore —— 浏览器模式（无 Tauri 时自动启用）
 * - TauriSqlStore —— Tauri 桌面模式（SQLite，经 window.__TAURI__ 调 plugin:sql）
 *
 * 这样业务代码（services/stores/views）完全不感知运行环境。
 */

export interface DataStore {
  readonly kind: 'memory' | 'indexeddb' | 'sqlite';
  get<T>(table: string, id: string): Promise<T | undefined>;
  /** 全表扫描（本地规模小，直接 list；排序过滤在上层做） */
  list<T>(table: string): Promise<T[]>;
  put<T>(table: string, id: string, value: T): Promise<void>;
  /** 批量写入（导入/恢复用） */
  bulkPut<T>(table: string, entries: { id: string; value: T }[]): Promise<void>;
  delete(table: string, id: string): Promise<void>;
  clear(table: string): Promise<void>;
  /** 供备份导出 */
  dump(): Promise<Record<string, unknown[]>>;
}

export const TABLES = [
  'cards',
  'card_versions',
  'templates',
  'skills',
  'ai_channels',
  'ai_usage_logs',
  'novel_projects',
  'settings',
  'categories',
] as const;

export type TableName = (typeof TABLES)[number];

export interface WithId {
  id: string;
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
