/**
 * token 分类统计（借鉴 piney 的四类统计）+ 字数统计。
 *
 * 分类正则与 piney 对齐：
 * - spec：ST 内置宏/占位（{{char}} 等）与 <tag> 标签
 * - wb：词边界文本（英文单词、数字）
 * - other：其余（对中文即逐字计费）
 *
 * 按需加载（ROADMAP P1-3）：cl100k ranks（约 5.6MB）经动态 import 独立成 chunk、
 * promise 单例，不再拖慢首屏。就绪前用 CJK 粗估并标记 estimated，
 * TokenBadge 显示「~」前缀，就绪后无感替换为精确值。
 */

export interface TokenStats {
  spec: number;
  wb: number;
  other: number;
  total: number;
  chars: number;
  /** true = BPE 词表尚未就绪，数值为 CJK 粗估（显示加 ~ 前缀） */
  estimated?: boolean;
}

/* ---- 惰性单例：动态 import ranks，独立 chunk ---- */

type Encoder = { encode: (s: string) => number[] };
let encoderPromise: Promise<Encoder> | undefined;

/** 预热编码器（调用方可在空闲期触发，不阻塞首屏） */
export function warmUpEncoder(): Promise<Encoder> {
  return getEncoder();
}

function getEncoder(): Promise<Encoder> {
  if (!encoderPromise) {
    encoderPromise = import('js-tiktoken/ranks/cl100k_base')
      .then((ranks) => new LiteTiktoken(ranks.default) as unknown as Encoder)
      .catch((e) => {
        // 加载失败回到永久粗估模式（下次调用重新尝试）
        console.warn('cl100k ranks 加载失败，token 统计退化为粗估模式：', e);
        encoderPromise = undefined;
        throw e;
      });
  }
  return encoderPromise;
}

// js-tiktoken/lite 的 Tiktoken 类（同步小模块，仅几 KB，可静态引入）
import { Tiktoken as LiteTiktoken } from 'js-tiktoken/lite';

/** 就绪前（或加载失败时）的 CJK 粗估：中文 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token */
function estimate(s: string): number {
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

/** 超长片段直接粗估，避免 BPE 对巨串的二次方级耗时（如内嵌 base64 图） */
const QUICK_LIMIT = 8_000;

function encodeLen(enc: Encoder | null, s: string): { n: number; estimated: boolean } {
  if (!enc) return { n: estimate(s), estimated: true };
  if (s.length > QUICK_LIMIT) return { n: estimate(s), estimated: true };
  return { n: enc.encode(s).length, estimated: false };
}

const SPEC_RE = /\{\{[^}]+\}\}|<\/?[a-zA-Z][^>\s/]*(?:\s[^>]*)?\/?>/g;
const WB_RE = /\b\w+\b/g;

/** 同步统计：编码器就绪前返回粗估（estimated: true），就绪后精确 */
export function countTokens(text: string): TokenStats {
  if (!text) return { spec: 0, wb: 0, other: 0, total: 0, chars: 0, estimated: true };

  // 优先用已就绪的编码器；未就绪走粗估并标记（不等待，保证同步签名）
  let enc: Encoder | null = null;
  if (encoderPromise) {
    // 已就绪时取到实例；pending 时保持 null（粗估），就绪后调用方刷新即为精确值
    enc = syncEncoder;
  }

  const specMatches = text.match(SPEC_RE) ?? [];
  let spec = 0;
  let anyEstimated = enc === null;
  for (const m of specMatches) {
    const r = encodeLen(enc, m);
    spec += r.n;
    anyEstimated ||= r.estimated;
  }

  const stripped = text.replace(SPEC_RE, ' ');
  const wbMatches = stripped.match(WB_RE) ?? [];
  let wb = 0;
  for (const w of wbMatches) {
    const r = encodeLen(enc, w);
    wb += r.n;
    anyEstimated ||= r.estimated;
  }

  const withoutWb = stripped.replace(WB_RE, ' ');
  const otherParts = withoutWb.split(/\s+/).filter(Boolean);
  let other = 0;
  for (const p of otherParts) {
    const r = encodeLen(enc, p);
    other += r.n;
    anyEstimated ||= r.estimated;
  }

  const total = spec + wb + other;
  return { spec, wb, other, total, chars: text.length, estimated: anyEstimated };
}

/** 编码器实例就绪后缓存（同步路径可用） */
let syncEncoder: Encoder | null = null;
void getEncoder()
  .then((enc) => {
    syncEncoder = enc;
  })
  .catch(() => undefined);

/** 异步精确统计：等待编码器就绪后统计（诊断报告等非渲染路径用） */
export async function countTokensExact(text: string): Promise<TokenStats> {
  try {
    const enc = await getEncoder();
    syncEncoder = enc;
    const stats = countTokens(text);
    return { ...stats, estimated: false };
  } catch {
    return countTokens(text);
  }
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
      estimated: acc.estimated || Boolean(f.stats.estimated),
    }),
    { spec: 0, wb: 0, other: 0, total: 0, chars: 0, estimated: false as boolean | undefined },
  );
  return { ...total, byField };
}
