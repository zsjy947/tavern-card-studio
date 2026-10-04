import { describe, it, expect } from 'vitest';
import { mulberry32, seedFromString } from './rng';

describe('mulberry32', () => {
  it('同种子序列完全一致（确定性）', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toStrictEqual(seqB);
  });

  it('不同种子序列不同', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(Array.from({ length: 10 }, () => a())).not.toStrictEqual(Array.from({ length: 10 }, () => b()));
  });

  it('取值范围 [0,1) 且记录种子', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(rng.seed).toBe(42);
  });
});

describe('seedFromString', () => {
  it('稳定且为 32bit 无符号整数', () => {
    expect(seedFromString('试卡-abc')).toBe(seedFromString('试卡-abc'));
    const n = seedFromString('anything');
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(0xffffffff);
  });

  it('不同字符串种子不同', () => {
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});
