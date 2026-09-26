/** 内存驱动（测试用） */
import { DEFAULT_PAGE_LIMIT, type DataStore } from './store';

export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const;
  private tables = new Map<string, Map<string, unknown>>();

  private table(name: string): Map<string, unknown> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async get<T>(table: string, id: string): Promise<T | undefined> {
    return this.table(table).get(id) as T | undefined;
  }

  async list<T>(table: string): Promise<T[]> {
    return [...this.table(table).values()] as T[];
  }

  async listPage<T>(table: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ rows: T[]; nextCursor: string | null }> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const ids = [...this.table(table).keys()].sort();
    const start = opts.cursor ? ids.findIndex((id) => id > opts.cursor!) : 0;
    const slice = start < 0 ? [] : ids.slice(start, start + limit + 1);
    const rows = slice.slice(0, limit).map((id) => this.table(table).get(id) as T);
    return { rows, nextCursor: slice.length > limit ? slice[limit - 1]! : null };
  }

  async put<T>(table: string, id: string, value: T): Promise<void> {
    this.table(table).set(id, value);
  }

  async bulkPut<T>(table: string, entries: { id: string; value: T }[]): Promise<void> {
    for (const e of entries) this.table(table).set(e.id, e.value);
  }

  async delete(table: string, id: string): Promise<void> {
    this.table(table).delete(id);
  }

  async clear(table: string): Promise<void> {
    this.table(table).clear();
  }

  async dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const [name, t] of this.tables) out[name] = [...t.values()];
    return out;
  }
}
