/**
 * 世界书 AI 批量生成 —— 批处理纯逻辑（借鉴 CardForge 的批量生成方法论，独立实现）：
 * - 每批固定 30 条（保证 JSON 不截断），批数 = 目标上限/30
 * - 批次间回传已生成条目名清单防重复
 * - 提前完成：已生成 ≥ 目标下限 且 ≥ 上限×0.8
 * - 中文引号硬规则（防 JSON 解析炸裂）
 * - 结果归一化：空对象过滤，整批空视为截断
 * - 朔规则注入：order=100、蓝灯 exclude_recursion、绿灯 prevent+exclude 双开
 * AI 调用编排见 services/lorebookAiService.ts（批次级 429 重试预算）。
 */
import type { BookEntry } from '../card/schema';

export type WorldbookStyle = 'auto' | 'concise' | 'narrative' | 'yaml';

export const WB_ENTRY_TYPES = [
  { key: 'system', label: '系统规则', order: '1-10', constant: true },
  { key: 'setting', label: '世界设定', order: '5-20', constant: false },
  { key: 'npc', label: 'NPC角色', order: '50-80', constant: false },
  { key: 'location', label: '地点场景', order: '30-50', constant: false },
  { key: 'event', label: '事件规则', order: '70-90', constant: false },
  { key: 'output', label: '输出格式', order: '9990-9999', constant: true },
] as const;

export type WbEntryType = (typeof WB_ENTRY_TYPES)[number]['key'];

export const WB_QUANTITY_TIERS = [
  { key: 'minimal', label: '极简（5-15 条）', min: 5, max: 15 },
  { key: 'small', label: '小型（20-35 条）', min: 20, max: 35 },
  { key: 'medium', label: '中型（40-70 条）', min: 40, max: 70 },
  { key: 'large', label: '大型（80-150 条）', min: 80, max: 150 },
  { key: 'huge', label: '超大型（150-300 条）', min: 150, max: 300 },
  { key: 'extreme', label: '极限（300-500 条）', min: 300, max: 500 },
] as const;

export const WB_STYLES: { key: WorldbookStyle; label: string }[] = [
  { key: 'auto', label: '自动匹配' },
  { key: 'concise', label: '简洁命令式（省 token）' },
  { key: 'narrative', label: '叙述体' },
  { key: 'yaml', label: 'YAML 结构化' },
];

export interface WorldbookGenParams {
  /** 世界观描述（必填） */
  worldview: string;
  entryTypes: WbEntryType[];
  tierIndex: number;
  style: WorldbookStyle;
  extraRequirement: string;
}

export const WB_BATCH_SIZE = 30;

/** 每批 30 条，批数 = ceil(上限/30) */
export function totalBatches(tierMax: number): number {
  return Math.max(1, Math.ceil(tierMax / WB_BATCH_SIZE));
}

/** 提前完成判定：≥ 目标下限 且 ≥ 上限×0.8 */
export function isBatchComplete(generated: number, tierMin: number, tierMax: number): boolean {
  return generated >= tierMin && generated >= Math.floor(tierMax * 0.8);
}

const JSON_QUOTE_RULE = `### JSON 引号规则（极重要）
- 所有 JSON 字符串值内出现的引用、引语、称号、书名一律使用中文引号「」『』《》，禁止在字符串值内使用英文双引号 "`;

const STYLE_RULES: Record<WorldbookStyle, string> = {
  auto: '描述风格由条目类型自动匹配：系统规则用命令式，设定用简洁说明，场景可用叙述。',
  concise: '描述风格：简洁命令式，直接说规则与事实，省 token，不写修饰性句子。',
  narrative: '描述风格：叙述体，用 2-4 句自然语言描述，保持沉浸感。',
  yaml: '描述风格：YAML 结构化分层（在 content 字符串内用换行+缩进书写，如"名称:\\n  属性: 值"）。',
};

/** 批量生成 system prompt（类型指导 + 风格 + 中文引号硬规则） */
export function buildBatchSystemPrompt(params: WorldbookGenParams): string {
  const typeGuide = params.entryTypes
    .map((k) => WB_ENTRY_TYPES.find((t) => t.key === k))
    .filter(Boolean)
    .map((t) => `- ${t!.label}：${t!.constant ? '常驻（constant=true，keys 为空数组）' : '触发（constant=false，给 2-4 个关键词）'}，insertion_order 建议 ${t!.order}`)
    .join('\n');
  return `你是世界书架构师，为 SillyTavern 角色卡的嵌套世界书（character_book）批量生成条目。

## 世界观
${params.worldview}

## 本次要生成的条目类型（只生成这些类型）
${typeGuide || '- 世界设定：触发条目，insertion_order 建议 5-20'}

${STYLE_RULES[params.style]}
${params.extraRequirement ? `\n## 额外要求\n${params.extraRequirement}` : ''}

## 输出格式
输出 JSON 数组，每个元素一个条目：
{"comment":"条目名（唯一，不重复）","keys":["关键词1","关键词2"],"secondary_keys":[],"content":"条目内容","constant":false,"insertion_order":100,"enabled":true}

规则：
1. 始终输出合法 JSON 数组；条目内容全中文
2. 条目名（comment）全局唯一；条目间内容不重复、不互相覆盖
3. content 具体自洽、可演绎，拒绝空泛套话；常驻条目 keys 为空数组，触发条目 keys 给本名/别称/关键词
${JSON_QUOTE_RULE}`;
}

/** 单批 user prompt：带已生成名单防重复 */
export function buildBatchUserPrompt(
  params: WorldbookGenParams,
  existingNames: string[],
  batchIndex: number,
  tierMax: number,
  referenceNovel?: string,
): string {
  const remain = Math.max(0, tierMax - existingNames.length);
  const parts = [
    existingNames.length
      ? `已生成 ${existingNames.length} 条：${existingNames.join('、')}\n\n请生成更多未覆盖的条目，不要重复已有的条目名与内容。`
      : `这是第 ${batchIndex + 1} 批。`,
    `本批生成不超过 ${Math.min(WB_BATCH_SIZE, Math.max(remain, 5))} 条（总体目标 ${remain} 条余量）。`,
  ];
  if (referenceNovel?.trim()) {
    parts.push(`## 参考小说素材（按它的世界观、人物风格、笔法来生成）\n${referenceNovel.slice(0, 8000)}`);
  }
  parts.push('只输出 JSON 数组。');
  return parts.join('\n\n');
}

/* ---------------- 结果归一化 ---------------- */

export interface RawWbEntry {
  comment: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  constant: boolean;
  insertion_order: number;
  enabled: boolean;
}

/**
 * 归一化一批 AI 输出：剔除非对象/空对象（无 comment 且无 content），
 * 字段兜底；同一批内与已有名单重名的条目丢弃。
 * @returns {entries, allEmpty} allEmpty=true 表示整批为空对象（截断/偷懒信号）
 */
export function normalizeBatchEntries(raw: unknown, existingNames: Set<string>): { entries: RawWbEntry[]; allEmpty: boolean } {
  if (!Array.isArray(raw)) return { entries: [], allEmpty: true };
  const entries: RawWbEntry[] = [];
  let emptyObjects = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      emptyObjects++;
      continue;
    }
    const o = item as Record<string, unknown>;
    const comment = typeof o.comment === 'string' ? o.comment.trim() : '';
    const content = typeof o.content === 'string' ? o.content.trim() : '';
    if (!comment && !content) {
      emptyObjects++;
      continue;
    }
    const name = comment || content.slice(0, 12);
    if (existingNames.has(name)) continue;
    existingNames.add(name);
    entries.push({
      comment: name,
      keys: Array.isArray(o.keys) ? o.keys.filter((k): k is string => typeof k === 'string' && !!k.trim()) : [],
      secondary_keys: Array.isArray(o.secondary_keys) ? o.secondary_keys.filter((k): k is string => typeof k === 'string') : [],
      content: content || comment,
      constant: o.constant === true || (Array.isArray(o.keys) && o.keys.length === 0 && o.constant !== false),
      insertion_order: typeof o.insertion_order === 'number' ? o.insertion_order : 100,
      enabled: o.enabled !== false,
    });
  }
  return { entries, allEmpty: entries.length === 0 && raw.length > 0 && emptyObjects === raw.length };
}

/**
 * 朔规则落卡：insertion_order 统一 100；蓝灯只开 exclude_recursion；
 * 绿灯 prevent_recursion + exclude_recursion 都开；extensions.position before_char→0 / after_char→1。
 */
export function shuoApplyEntry(raw: RawWbEntry, id: number, referenceNovel?: string): BookEntry {
  const constant = raw.constant;
  const position = constant ? 'before_char' : 'after_char';
  const entry: BookEntry = {
    id,
    keys: constant ? [] : raw.keys,
    secondary_keys: raw.secondary_keys,
    comment: raw.comment,
    content: raw.content,
    constant,
    selective: !constant,
    insertion_order: 100,
    enabled: raw.enabled,
    position,
    use_regex: false,
    extensions: {
      position: constant ? 0 : 1,
      depth: 4,
      exclude_recursion: true,
      prevent_recursion: !constant,
      probability: 100,
      useProbability: true,
      selectiveLogic: 0,
    },
  };
  if (referenceNovel) entry.extensions.tcsFromReferenceNovel = true;
  return entry;
}

/** 参考小说素材段（批量生成 / 单条重生成 / 继续补充共用） */
export function referenceNovelSegment(novel: string): string {
  if (!novel?.trim()) return '';
  return `\n\n## 参考小说素材（按它的世界观、人物风格、笔法来生成 / 改写）\n${novel.slice(0, 8000)}`;
}
