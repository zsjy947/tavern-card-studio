/**
 * 卡片归一化与 V1→V2→V3 迁移。
 *
 * 归一化 = 把任意来源（V1 顶层 / V2 / V3 / 社区卡乱格式）统一为内部规范形态：
 * 1. data 块优先；无 data 时从顶层 V1 字段合成
 * 2. tags 数组/逗号字符串兼容
 * 3. creator 缺失时回退 creatorcomment 等
 * 4. 导出时补齐顶层冗余字段（部分旧前端只读顶层）
 */
import {
  SPEC_V2,
  SPEC_V3,
  looseCardSchema,
  cardDataV3Schema,
  type AnyCard,
  type CardData,
  type CardDataV3,
} from './schema';

/** 宽容解析原始 JSON 为内部卡片对象；识别不了 spec 时按内容推断 */
export function parseLooseCard(raw: unknown): AnyCard {
  const loose = looseCardSchema.parse(raw ?? {});

  let dataRaw: Record<string, unknown>;
  if (loose.data && typeof loose.data === 'object') {
    dataRaw = { ...(loose.data as Record<string, unknown>) };
  } else {
    // V1：所有内容都在顶层
    dataRaw = { ...(loose as Record<string, unknown>) };
    delete dataRaw.spec;
    delete dataRaw.spec_version;
  }

  // 顶层冗余字段优先级低于 data 内字段
  const topFallback: Record<string, unknown> = {};
  for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'] as const) {
    const v = loose[k];
    if (typeof v === 'string' && v !== '') topFallback[k] = v;
  }
  if (loose.creatorcomment) topFallback.creator_notes = loose.creatorcomment;
  if (loose.tags !== undefined) topFallback.tags = loose.tags;
  dataRaw = { ...topFallback, ...stripEmpty(dataRaw) };

  const isV3 = loose.spec === SPEC_V3 || (loose.data as { spec?: string })?.spec === SPEC_V3;
  if (isV3) {
    const data = cardDataV3Schema.parse(dataRaw);
    return finalizeV3(data, loose);
  }
  // 无 spec 视为 V2（V1 内容已并入 dataRaw；字段远超 V1 集合也能容纳）
  const data = parseV2Data(dataRaw);
  return finalizeV2(data, loose);
}

function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** 手动做 V2 data 的默认值填充（schema.default 只在新字段缺失时生效） */
function parseV2Data(raw: Record<string, unknown>): CardData {
  // 借助 zod 默认值：直接对 v3 schema 做部分校验再丢弃 v3 专属字段
  const v3 = cardDataV3Schema.parse(raw);
  const v2: CardData = {
    name: v3.name,
    description: v3.description,
    personality: v3.personality,
    scenario: v3.scenario,
    first_mes: v3.first_mes,
    mes_example: v3.mes_example,
    creator_notes: v3.creator_notes,
    system_prompt: v3.system_prompt,
    post_history_instructions: v3.post_history_instructions,
    alternate_greetings: v3.alternate_greetings,
    tags: v3.tags,
    creator: v3.creator,
    character_version: v3.character_version,
    extensions: v3.extensions,
    character_book: v3.character_book,
  };
  return v2;
}

function today(): string {
  return new Date().toISOString();
}

function finalizeV2(data: CardData, loose: { create_date?: string; talkativeness?: string | number; fav?: boolean; avatar?: unknown }): AnyCard {
  return {
    spec: SPEC_V2,
    spec_version: '2.0',
    data,
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    tags: data.tags,
    creatorcomment: data.creator_notes,
    avatar: typeof loose.avatar === 'string' ? loose.avatar : 'none',
    talkativeness: data.extensions.talkativeness ?? loose.talkativeness ?? '0.5',
    fav: data.extensions.fav ?? loose.fav ?? false,
    create_date: loose.create_date ?? today(),
  };
}

function finalizeV3(data: CardDataV3, loose: { create_date?: string; talkativeness?: string | number; fav?: boolean; avatar?: unknown }): AnyCard {
  return {
    spec: SPEC_V3,
    spec_version: '3.0',
    data,
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    tags: data.tags,
    creatorcomment: data.creator_notes,
    avatar: typeof loose.avatar === 'string' ? loose.avatar : 'none',
    talkativeness: data.extensions.talkativeness ?? loose.talkativeness ?? '0.5',
    fav: data.extensions.fav ?? loose.fav ?? false,
    create_date: loose.create_date ?? today(),
  };
}

/** 建一张空白 V3 卡 */
export function blankCard(name = '新角色'): AnyCard {
  return parseLooseCard({ spec: SPEC_V3, spec_version: '3.0', data: { name } });
}

/** V2 → V3 迁移：平移全部字段，v3 专属字段取默认 */
export function migrateV2toV3(card: AnyCard): AnyCard {
  const data = cardDataV3Schema.parse(card.data);
  return finalizeV3(data, card);
}

/** V3 → V2 降级：丢弃 v3 专属字段（多语言/个人备注），其余保留 */
export function downgradeV3toV2(card: AnyCard): AnyCard {
  const data = parseV2Data(card.data as Record<string, unknown>);
  return finalizeV2(data, card);
}

/** 按目标规格转换 */
export function convertSpec(card: AnyCard, target: 'v2' | 'v3'): AnyCard {
  if (target === 'v3') return card.spec === SPEC_V3 ? card : migrateV2toV3(card);
  return card.spec === SPEC_V2 ? card : downgradeV3toV2(card);
}

/** 判断当前卡实际规格 */
export function cardSpec(card: AnyCard): 'v1' | 'v2' | 'v3' {
  if (card.spec === SPEC_V3) return 'v3';
  if (card.spec === SPEC_V2) return 'v2';
  return 'v1';
}
