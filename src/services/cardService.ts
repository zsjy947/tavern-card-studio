/**
 * 卡片服务：导入（归一化 + 去重 + 初始快照）、保存（自动快照）、版本管理、diff。
 */
import { getStore, genId } from '@/db';
import {
  parseLooseCard, convertSpec, blankCard, dataHash,
  type AnyCard,
} from '@/core/card';
import { extractCardFromPng, injectCardIntoPng, makePlaceholderPng } from '@/core/png';
import { sumTokenStats } from '@/core/stats/tokens';
import { getSetting, SETTING_KEYS } from './appSettings';
import type { CardRow, CardVersionRow } from './types';

export interface ImportResult {
  row: CardRow;
  /** 命中已有卡（data_hash 相同）时为被覆盖的卡名 */
  replacedName?: string;
  warnings: string[];
}

function now(): string {
  return new Date().toISOString();
}

function computeTokenStats(card: AnyCard) {
  const d = card.data as Record<string, unknown>;
  return sumTokenStats([
    { label: 'description', text: String(d.description ?? '') },
    { label: 'personality', text: String(d.personality ?? '') },
    { label: 'scenario', text: String(d.scenario ?? '') },
    { label: 'first_mes', text: String(d.first_mes ?? '') },
    { label: 'mes_example', text: String(d.mes_example ?? '') },
    { label: 'system_prompt', text: String(d.system_prompt ?? '') },
    { label: 'post_history_instructions', text: String(d.post_history_instructions ?? '') },
    ...((d.alternate_greetings as string[] | undefined) ?? []).map((g, i) => ({ label: `alt_${i}`, text: g })),
    ...(((d.character_book as { entries?: { content: string }[] } | undefined)?.entries ?? []).map((e, i) => ({ label: `book_${i}`, text: e.content ?? '' }))),
  ]);
}

function toRow(card: AnyCard, existing?: Partial<CardRow>): CardRow {
  const ts = now();
  return {
    id: existing?.id ?? genId('card'),
    name: card.data.name,
    spec: card.spec,
    tags: card.data.tags ?? [],
    categoryId: existing?.categoryId ?? null,
    card,
    cover: existing?.cover ?? null,
    tokenStats: computeTokenStats(card),
    dataHash: dataHash(card.data),
    deletedAt: null,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
}

/** 导入 JSON 文本（或已解析对象）为卡 */
export async function importCardFromJson(rawText: string | unknown, opts: { targetSpec?: 'v2' | 'v3' } = {}): Promise<ImportResult> {
  const warnings: string[] = [];
  let raw: unknown;
  if (typeof rawText === 'string') {
    try {
      raw = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`JSON 解析失败：${(e as Error).message}`);
    }
  } else {
    raw = rawText;
  }
  let card = parseLooseCard(raw);
  if (opts.targetSpec) card = convertSpec(card, opts.targetSpec);
  if (!card.data.name) warnings.push('卡名为空，已重命名为「未命名角色」');
  if (!card.data.name) card = parseLooseCard({ ...card, data: { ...card.data, name: '未命名角色' } });

  return finishImport(card, warnings);
}

/** 导入 PNG 卡（自动抽元数据） */
export async function importCardFromPng(bytes: Uint8Array, opts: { pngBytes?: Uint8Array; targetSpec?: 'v2' | 'v3' } = {}): Promise<ImportResult> {
  const { raw, source } = extractCardFromPng(bytes);
  const warnings = [`元数据来自 tEXt 块：${source}`];
  let card = parseLooseCard(raw);
  if (opts.targetSpec) card = convertSpec(card, opts.targetSpec);
  const res = await finishImport(card, warnings);
  // PNG 底图作为封面
  if (!res.row.cover) {
    res.row.cover = await pngToDataUrl(bytes);
    await (await getStore()).put('cards', res.row.id, res.row);
  }
  return res;
}

async function finishImport(card: AnyCard, warnings: string[]): Promise<ImportResult> {
  const store = await getStore();
  const hash = dataHash(card.data);
  const existing = (await store.list<CardRow>('cards')).find(
    (c) => c.dataHash === hash && !c.deletedAt,
  );
  let replacedName: string | undefined;
  let row: CardRow;
  if (existing) {
    replacedName = existing.name;
    row = toRow(card, existing);
  } else {
    row = toRow(card);
  }
  await store.put('cards', row.id, row);
  // 初始版本快照
  await addVersion(row.id, card, existing ? '导入覆盖' : '导入');
  return { row, replacedName, warnings };
}

/** 新建空白卡 */
export async function createCard(name: string, templateCard?: AnyCard): Promise<CardRow> {
  const card = templateCard ?? blankCard(name);
  if (templateCard) {
    card.data.name = name;
  }
  const store = await getStore();
  const row = toRow(card);
  await store.put('cards', row.id, row);
  await addVersion(row.id, card, '创建');
  return row;
}

export async function listCards(includeDeleted = false): Promise<CardRow[]> {
  const store = await getStore();
  const all = await store.list<CardRow>('cards');
  const filtered = includeDeleted ? all : all.filter((c) => !c.deletedAt);
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 虚拟滚动启用阈值（ROADMAP P3-4）：超过该张数列表走分页+行虚拟化 */
export const VIRTUAL_SCROLL_THRESHOLD = 500;

/**
 * 分页读卡（keyset 游标，只作用于展示路径；导入/去重仍全量）。
 * 返回按 updatedAt 降序的一页与 nextCursor（null=到底）。
 */
export async function listCardsPaged(
  opts: { cursor?: string; limit?: number; includeDeleted?: boolean } = {},
): Promise<{ rows: CardRow[]; nextCursor: string | null }> {
  const store = await getStore();
  const limit = opts.limit ?? 100;
  const result = await store.listPage<CardRow>('cards', { cursor: opts.cursor, limit });
  const rows = result.rows.filter((c) => (opts.includeDeleted ? true : !c.deletedAt)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { rows, nextCursor: result.nextCursor };
}

export async function getCard(id: string): Promise<CardRow | undefined> {
  return (await getStore()).get<CardRow>('cards', id);
}

/** 保存卡：内容变化时自动快照；note 非空时强制快照 */
export async function saveCard(id: string, cardIn: AnyCard, opts: { note?: string; forceSnapshot?: boolean; keepCover?: boolean } = {}): Promise<CardRow> {
  // 剥离 Vue 响应式 Proxy（IndexedDB 结构化克隆会失败）
  const card = JSON.parse(JSON.stringify(cardIn)) as AnyCard;
  const store = await getStore();
  const prev = await store.get<CardRow>('cards', id);
  if (!prev) throw new Error(`卡不存在：${id}`);
  const hash = dataHash(card.data);
  const changed = hash !== prev.dataHash;
  const row = toRow(card, prev);
  if (opts.keepCover) row.cover = prev.cover;
  await store.put('cards', id, row);
  if (changed && (opts.forceSnapshot || opts.note || true)) {
    await addVersion(id, card, opts.note || '编辑保存');
  }
  return row;
}

export async function updateCardPatch(id: string, patch: Partial<CardRow>): Promise<CardRow> {
  const store = await getStore();
  const prev = await store.get<CardRow>('cards', id);
  if (!prev) throw new Error(`卡不存在：${id}`);
  const next = { ...prev, ...patch, updatedAt: now() };
  await store.put('cards', id, next);
  return next;
}

/** 软删除 → 回收站 */
export async function trashCard(id: string): Promise<void> {
  await updateCardPatch(id, { deletedAt: now() });
}

export async function restoreCard(id: string): Promise<void> {
  await updateCardPatch(id, { deletedAt: null });
}

export async function hardDeleteCard(id: string): Promise<void> {
  const store = await getStore();
  const versions = (await store.list<CardVersionRow>('card_versions')).filter((v) => v.cardId === id);
  for (const v of versions) await store.delete('card_versions', v.id);
  await store.delete('cards', id);
}

/* ---------------- 版本 ---------------- */

export async function addVersion(cardId: string, card: AnyCard, note: string): Promise<CardVersionRow> {
  const store = await getStore();
  const existing = (await store.list<CardVersionRow>('card_versions'))
    .filter((v) => v.cardId === cardId)
    .sort((a, b) => b.versionNo - a.versionNo);
  const versionNo = (existing[0]?.versionNo ?? 0) + 1;
  const row: CardVersionRow = {
    id: genId('ver'),
    cardId,
    versionNo,
    note,
    card: JSON.parse(JSON.stringify(card)) as AnyCard,
    dataHash: dataHash(card.data),
    createdAt: now(),
  };
  await store.put('card_versions', row.id, row);
  // 版本上限 50，超出删除最老的
  if (existing.length + 1 > 50) {
    const toRemove = [...existing, row].sort((a, b) => a.versionNo - b.versionNo).slice(0, existing.length + 1 - 50);
    for (const r of toRemove) await store.delete('card_versions', r.id);
  }
  return row;
}

export async function listVersions(cardId: string): Promise<CardVersionRow[]> {
  const store = await getStore();
  return (await store.list<CardVersionRow>('card_versions'))
    .filter((v) => v.cardId === cardId)
    .sort((a, b) => b.versionNo - a.versionNo);
}

export async function rollbackToVersion(cardId: string, versionId: string): Promise<CardRow> {
  const store = await getStore();
  const ver = await store.get<CardVersionRow>('card_versions', versionId);
  if (!ver || ver.cardId !== cardId) throw new Error('版本不存在');
  const saved = await saveCard(cardId, JSON.parse(JSON.stringify(ver.card)) as AnyCard, {
    note: `回滚到 v${ver.versionNo}`,
  });
  return saved;
}

/* ---------------- diff ---------------- */

export interface FieldDiff {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

const DIFF_FIELDS = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions',
];

/** 两个版本的字段级 diff（世界书/正则以 JSON 串对比） */
export function diffCards(a: AnyCard, b: AnyCard): FieldDiff[] {
  const out: FieldDiff[] = [];
  const da = a.data as Record<string, unknown>;
  const db = b.data as Record<string, unknown>;
  for (const f of DIFF_FIELDS) {
    const va = String(da[f] ?? '');
    const vb = String(db[f] ?? '');
    if (va !== vb) out.push({ field: f, kind: va && !vb ? 'removed' : !va && vb ? 'added' : 'changed', before: va, after: vb });
  }
  const sa = JSON.stringify(da.alternate_greetings ?? []);
  const sb = JSON.stringify(db.alternate_greetings ?? []);
  if (sa !== sb) out.push({ field: 'alternate_greetings', kind: 'changed', before: sa, after: sb });
  const ba = (da.character_book as { entries?: unknown[] } | undefined)?.entries;
  const bb = (db.character_book as { entries?: unknown[] } | undefined)?.entries;
  if (JSON.stringify(ba ?? []) !== JSON.stringify(bb ?? [])) {
    out.push({
      field: 'character_book',
      kind: 'changed',
      before: `共 ${ba?.length ?? 0} 条`,
      after: `共 ${bb?.length ?? 0} 条`,
    });
  }
  const ra = (da.extensions as { regex_scripts?: unknown[] } | undefined)?.regex_scripts;
  const rb = (db.extensions as { regex_scripts?: unknown[] } | undefined)?.regex_scripts;
  if (JSON.stringify(ra ?? []) !== JSON.stringify(rb ?? [])) {
    out.push({ field: 'regex_scripts', kind: 'changed', before: `共 ${ra?.length ?? 0} 个`, after: `共 ${rb?.length ?? 0} 个` });
  }
  return out;
}

/* ---------------- 导出 ---------------- */

export function cardToJsonText(card: AnyCard): string {
  return JSON.stringify(card, null, 2);
}

/** 卡导出为 PNG（无底图用占位）；未显式指定 dualWrite 时读设置页偏好（默认双写） */
export async function cardToPngBytes(card: AnyCard, basePng?: Uint8Array | null, opts: { dualWrite?: boolean } = {}): Promise<Uint8Array> {
  let dualWrite = opts.dualWrite;
  if (dualWrite === undefined) {
    dualWrite = await getSetting(SETTING_KEYS.pngDualWrite, true);
  }
  const base = basePng && basePng.length > 8 ? basePng : makePlaceholderPng(256);
  return injectCardIntoPng(base, cardToJsonText(card), { dualWrite });
}

export async function pngToDataUrl(bytes: Uint8Array): Promise<string> {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return `data:image/png;base64,${b64}`;
}
