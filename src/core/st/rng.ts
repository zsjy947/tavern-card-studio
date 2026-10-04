/**
 * 确定性随机源（mulberry32）：组装引擎内一切随机——世界书 probability 掷骰、
 * 组权重选举、{{random}}/{{pick}}/{{roll}} 宏——统一走这里，同 seed 同输入必得
 * 同结果。试卡重放与黄金 fixture 门禁都以此为前提。
 */

export interface Rng {
  (): number; // [0, 1)
  seed: number;
}

/** mulberry32：32bit 状态、分布与速度兼顾的公开域小型 PRNG */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const fn = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = fn as Rng;
  rng.seed = seed >>> 0;
  return rng;
}

/** 字符串 → 32bit 种子（FNV-1a，与 core/card/hash 同族算法） */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
