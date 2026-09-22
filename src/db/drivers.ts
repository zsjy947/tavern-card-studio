/** 内存驱动（测试用） */
import type { DataStore } from './store';

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
