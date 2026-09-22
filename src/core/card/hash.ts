/**
 * 卡片内容指纹：用于导入去重与「有无实质修改」判断。
 *
 * 只对影响行为的字段计算（排除 create_date / fav / 显示索引等噪声），
 * 采用 FNV-1a（实现小、无依赖、非安全场景足够）。
 */

const FNV_OFFSET = 0x811c9dc5;

function fnv1a(str: string, seed = FNV_OFFSET): number {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 稳定字符串化：对象键排序，保证同内容不同键序哈希一致 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** 影响卡片行为的字段集合 */
const SIGNIFICANT_FIELDS = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings',
  'tags', 'creator', 'character_version', 'extensions', 'character_book',
] as const;

export function dataHash(data: unknown): string {
  const obj = (data ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const k of SIGNIFICANT_FIELDS) picked[k] = obj[k];
  const s = stableStringify(picked);
  // 64bit：两轮不同种子
  const h1 = fnv1a(s).toString(16).padStart(8, '0');
  const h2 = fnv1a(s, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${h1}${h2}`;
}
