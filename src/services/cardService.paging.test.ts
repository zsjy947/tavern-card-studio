import { beforeEach, describe, expect, it } from 'vitest';
import { setStore, DEFAULT_PAGE_LIMIT } from '@/db';
import { MemoryStore } from '@/db/drivers';
import { listCardsPaged, VIRTUAL_SCROLL_THRESHOLD } from './cardService';

interface Row {
  id: string;
  name: string;
  updatedAt: string;
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `card_${String(i).padStart(4, '0')}`,
    name: `卡${i}`,
    updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }));
}

describe('listPage keyset 分页（P3-4）', () => {
  beforeEach(() => {
    setStore(new MemoryStore());
  });

  it('listPage 与 list 全量等价（按 id 升序切页拼接）', async () => {
    const store = (await import('@/db')).getStore;
    const s = await store();
    const all = makeRows(57);
    for (const r of all) await s.put('cards', r.id, r);

    // 全量 list（任意顺序）按 id 排序后为基准
    const expected = [...(await s.list<Row>('cards'))].map((r) => r.id).sort();

    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await s.listPage<Row>('cards', { cursor, limit: 20 });
      paged.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
      if (!page.nextCursor) break;
    } while (true);
    expect(paged).toEqual(expected);
  });

  it('nextCursor 语义：末页为 null；页大小默认值生效', async () => {
    const store = (await import('@/db')).getStore;
    const s = await store();
    for (const r of makeRows(DEFAULT_PAGE_LIMIT + 3)) await s.put('cards', r.id, r);

    const p1 = await s.listPage<Row>('cards');
    expect(p1.rows).toHaveLength(DEFAULT_PAGE_LIMIT);
    expect(p1.nextCursor).toBe(p1.rows[p1.rows.length - 1]!.id);

    const p2 = await s.listPage<Row>('cards', { cursor: p1.nextCursor! });
    expect(p2.rows).toHaveLength(3);
    expect(p2.nextCursor).toBeNull();
  });

  it('listCardsPaged：分页读出后按 updatedAt 降序', async () => {
    const store = (await import('@/db')).getStore;
    const s = await store();
    for (const r of makeRows(30)) await s.put('cards', r.id, { ...r, deletedAt: null });

    const p = await listCardsPaged({ limit: 10 });
    expect(p.rows).toHaveLength(10);
    const times = p.rows.map((r) => r.updatedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(p.nextCursor).toBeTruthy();
  });

  it('阈值常量：500 张以上启用虚拟化', () => {
    expect(VIRTUAL_SCROLL_THRESHOLD).toBe(500);
  });
});
