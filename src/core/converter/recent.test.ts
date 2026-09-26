import { describe, expect, it } from 'vitest';
import { pushRecent, shouldKeepProduct, PRODUCT_KEEP_LIMIT, RECENT_CAP, type RecentConversion } from './recent';

function entry(i: number): RecentConversion {
  return {
    id: `c${i}`,
    direction: 'png2json',
    fileName: `src${i}.png`,
    cardName: `卡${i}`,
    spec: 'v3',
    sizeBytes: 1000 + i,
    savedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    outputName: `卡${i}.json`,
  };
}

describe('recent conversions 纯逻辑（P1-4）', () => {
  it('最新在前；上限 50 淘汰最老', () => {
    let list: RecentConversion[] = [];
    for (let i = 0; i < RECENT_CAP + 10; i++) list = pushRecent(list, entry(i));
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0]!.id).toBe(`c${RECENT_CAP + 9}`);
    expect(list.at(-1)!.id).toBe('c10'); // 最老的 10 条被淘汰
  });

  it('同 id 幂等（重转同一条不会重复）', () => {
    let list = pushRecent([], entry(1));
    list = pushRecent(list, entry(2));
    list = pushRecent(list, { ...entry(1), sizeBytes: 999 });
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('c1');
    expect(list[0]!.sizeBytes).toBe(999);
  });

  it('产物保留阈值：≤2MB 保留，>2MB 不保留', () => {
    expect(shouldKeepProduct(1024)).toBe(true);
    expect(shouldKeepProduct(PRODUCT_KEEP_LIMIT)).toBe(true);
    expect(shouldKeepProduct(PRODUCT_KEEP_LIMIT + 1)).toBe(false);
    expect(shouldKeepProduct(0)).toBe(false);
  });
});
