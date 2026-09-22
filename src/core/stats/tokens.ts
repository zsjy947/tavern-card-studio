/**
 * token 分类统计（借鉴 piney 的四类统计）+ 字数统计。
 *
 * 分类正则与 piney 对齐：
 * - spec：ST 内置宏/占位（{{char}} 等）与 <tag> 标签
 * - wb：词边界文本（英文单词、数字）
 * - other：其余（对中文即逐字计费）
 */
import { getEncoding } from 'js-tiktoken';

export interface TokenStats {
  spec: number;
  wb: number;
  other: number;
  total: number;
  chars: number;
}

const enc = getEncoding('cl100k_base');

/** 超长片段直接粗估，避免 BPE 对巨串的二次方级耗时（如内嵌 base64 图） */
const QUICK_LIMIT = 8_000;

function encodeLen(s: string): number {
  if (s.length <= QUICK_LIMIT) return enc.encode(s).length;
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

const SPEC_RE = /\{\{[^}]+\}\}|<\/?[a-zA-Z][^>\s/]*(?:\s[^>]*)?\/?>/g;
const WB_RE = /\b\w+\b/g;

export function countTokens(text: string): TokenStats {
  if (!text) return { spec: 0, wb: 0, other: 0, total: 0, chars: 0 };
  const specMatches = text.match(SPEC_RE) ?? [];
  const spec = specMatches.reduce((acc, m) => acc + encodeLen(m), 0);

  const stripped = text.replace(SPEC_RE, ' ');
  const wbMatches = stripped.match(WB_RE) ?? [];
  const wbTokens = wbMatches.map((w) => encodeLen(w));
  const wb = wbTokens.reduce((a, b) => a + b, 0);

  const withoutWb = stripped.replace(WB_RE, ' ');
  const otherParts = withoutWb.split(/\s+/).filter(Boolean);
  const other = otherParts.reduce((acc, p) => acc + encodeLen(p), 0);

  const total = spec + wb + other;
  return { spec, wb, other, total, chars: text.length };
}

/** 多字段汇总（整卡统计） */
export function sumTokenStats(items: { label: string; text: string }[]): TokenStats & { byField: { label: string; stats: TokenStats }[] } {
  const byField = items.map((i) => ({ label: i.label, stats: countTokens(i.text) }));
  const total = byField.reduce(
    (acc, f) => ({
      spec: acc.spec + f.stats.spec,
      wb: acc.wb + f.stats.wb,
      other: acc.other + f.stats.other,
      total: acc.total + f.stats.total,
      chars: acc.chars + f.stats.chars,
    }),
    { spec: 0, wb: 0, other: 0, total: 0, chars: 0 },
  );
  return { ...total, byField };
}
