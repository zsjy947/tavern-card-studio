/**
 * 世界书双向互转：内嵌 character_book（规范嵌套格式）⇄ ST 全局世界书（扁平格式）。
 *
 * 字段映射对齐 SillyTavern world-info.js 的 convertCharacterBook（权威实现），
 * ST 专属字段（递归/概率/深度/分组等）保存在条目 extensions 中不丢失。
 */

import type { BookEntry, CharacterBook } from '../card/schema';

/* ---------------- ST 全局世界书格式 ---------------- */

export const WI_POSITION = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
} as const;

export const WI_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
} as const;

export const WI_ROLE = { system: 0, user: 1, assistant: 2 } as const;

export interface WorldInfoEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  selectiveLogic: number;
  addMemo: boolean;
  order: number;
  position: number;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  role: number;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  displayIndex: number;
  disable: boolean;
  outletName: string;
  ignoreBudget: boolean;
  extensions: Record<string, unknown>;
  [k: string]: unknown;
}

export interface WorldInfoBook {
  entries: Record<string, WorldInfoEntry>;
  name?: string;
  description?: string;
  /** 原始 character_book 数据（ST 导入时保留） */
  originalData?: unknown;
}

export function newWorldInfoEntry(uid: number, overrides: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: WI_LOGIC.AND_ANY,
    addMemo: true,
    order: 100,
    position: WI_POSITION.before,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: WI_ROLE.system,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: uid,
    disable: false,
    outletName: '',
    ignoreBudget: false,
    extensions: {},
    ...overrides,
  };
}

/* ---------------- 内嵌 → ST 全局 ---------------- */

/** character_book（嵌套）→ ST 全局世界书（扁平，entries 以 uid 为键的对象） */
export function characterBookToWorldInfo(book: Pick<CharacterBook, 'name'> & { entries: BookEntry[] }): WorldInfoBook {
  const result: WorldInfoBook = { entries: {}, name: book.name, originalData: book };
  book.entries.forEach((entry, index) => {
    const id = entry.id ?? index;
    result.entries[String(id)] = embeddedToWiEntry(entry, index);
  });
  return result;
}

export function embeddedToWiEntry(entry: BookEntry, index = 0): WorldInfoEntry {
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  const nullableNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const nullableBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  return newWorldInfoEntry(id(entry, index), {
    key: [...entry.keys],
    keysecondary: [...entry.secondary_keys],
    comment: entry.comment ?? '',
    content: entry.content,
    constant: entry.constant ?? false,
    selective: entry.selective ?? false,
    order: entry.insertion_order,
    position: positionToWi(entry, ext),
    excludeRecursion: bool(ext.exclude_recursion, false),
    preventRecursion: bool(ext.prevent_recursion, false),
    delayUntilRecursion: bool(ext.delay_until_recursion, false),
    disable: !(entry.enabled ?? true),
    addMemo: Boolean(entry.comment),
    displayIndex: num(ext.display_index, index),
    probability: num(ext.probability, 100),
    useProbability: bool(ext.useProbability, true),
    depth: num(ext.depth, 4),
    selectiveLogic: num(ext.selectiveLogic, WI_LOGIC.AND_ANY),
    outletName: typeof ext.outlet_name === 'string' ? ext.outlet_name : '',
    group: typeof ext.group === 'string' ? ext.group : '',
    groupOverride: bool(ext.group_override, false),
    groupWeight: num(ext.group_weight, 100),
    scanDepth: nullableNum(ext.scan_depth),
    caseSensitive: nullableBool(ext.case_sensitive),
    matchWholeWords: nullableBool(ext.match_whole_words),
    useGroupScoring: nullableBool(ext.use_group_scoring),
    automationId: typeof ext.automation_id === 'string' ? ext.automation_id : '',
    role: num(ext.role, WI_ROLE.system),
    vectorized: bool(ext.vectorized, false),
    sticky: nullableNum(ext.sticky),
    cooldown: nullableNum(ext.cooldown),
    delay: nullableNum(ext.delay),
    extensions: ext,
  });
}

function id(entry: BookEntry, index: number): number {
  return typeof entry.id === 'number' ? entry.id : index;
}

function positionToWi(entry: BookEntry, ext: Record<string, unknown>): number {
  if (typeof ext.position === 'number') return ext.position;
  return entry.position === 'after_char' ? WI_POSITION.after : WI_POSITION.before;
}

/* ---------------- ST 全局 → 内嵌 ---------------- */

/** ST 全局世界书 → character_book（嵌套）。宽松接受 entries 为对象或数组。 */
export function worldInfoToCharacterBook(wi: WorldInfoBook | { entries: Record<string, WorldInfoEntry> }, name?: string): CharacterBook {
  const rawEntries = (wi as WorldInfoBook).entries ?? {};
  const list: WorldInfoEntry[] = Array.isArray(rawEntries)
    ? (rawEntries as unknown as WorldInfoEntry[])
    : Object.values(rawEntries);
  const book: CharacterBook = {
    name: name ?? (wi as WorldInfoBook).name ?? '',
    description: (wi as WorldInfoBook).description ?? '',
    extensions: {},
    entries: list.map((e, i) => wiEntryToEmbedded(e, i)),
  };
  return book;
}

export function wiEntryToEmbedded(e: WorldInfoEntry, index = 0): BookEntry {
  const ext: Record<string, unknown> = { ...(e.extensions ?? {}) };
  // ST 专属字段落到 extensions（规范没有的字段都进这里，导入回 ST 不丢）
  const drop = new Set([
    'position', 'exclude_recursion', 'prevent_recursion', 'delay_until_recursion',
    'display_index', 'probability', 'useProbability', 'depth', 'selectiveLogic',
    'outlet_name', 'group', 'group_override', 'group_weight', 'scan_depth',
    'case_sensitive', 'match_whole_words', 'use_group_scoring', 'automation_id',
    'role', 'vectorized', 'sticky', 'cooldown', 'delay', 'triggers', 'ignore_budget',
  ]);
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ext)) if (!drop.has(k)) keep[k] = v;

  const embedded: BookEntry = {
    id: typeof e.uid === 'number' ? e.uid : index,
    keys: [...(e.key ?? [])],
    secondary_keys: [...(e.keysecondary ?? [])],
    comment: e.comment ?? '',
    content: e.content ?? '',
    constant: e.constant ?? false,
    selective: e.selective ?? false,
    insertion_order: e.order ?? 100,
    enabled: !(e.disable ?? false),
    position: positionFromWi(e),
    use_regex: false,
    extensions: {
      ...keep,
      position: e.position ?? WI_POSITION.before,
      exclude_recursion: e.excludeRecursion ?? false,
      prevent_recursion: e.preventRecursion ?? false,
      delay_until_recursion: e.delayUntilRecursion ?? false,
      display_index: e.displayIndex ?? index,
      probability: e.probability ?? 100,
      useProbability: e.useProbability ?? true,
      depth: e.depth ?? 4,
      selectiveLogic: e.selectiveLogic ?? WI_LOGIC.AND_ANY,
      outlet_name: e.outletName ?? '',
      group: e.group ?? '',
      group_override: e.groupOverride ?? false,
      group_weight: e.groupWeight ?? 100,
      scan_depth: e.scanDepth ?? null,
      case_sensitive: e.caseSensitive ?? null,
      match_whole_words: e.matchWholeWords ?? null,
      use_group_scoring: e.useGroupScoring ?? null,
      automation_id: e.automationId ?? '',
      role: e.role ?? WI_ROLE.system,
      vectorized: e.vectorized ?? false,
      sticky: e.sticky ?? null,
      cooldown: e.cooldown ?? null,
      delay: e.delay ?? null,
    },
  };
  return embedded;
}

function positionFromWi(e: WorldInfoEntry): 'before_char' | 'after_char' {
  const p = e.position ?? WI_POSITION.before;
  // 0/1 对应 before/after；2-6 为 ST 高级位置，嵌入卡内只能表达为 before/after（原始值保留在 extensions.position）
  return p === WI_POSITION.after || p === WI_POSITION.ANBottom || p === WI_POSITION.EMBottom
    ? 'after_char'
    : 'before_char';
}

/* ---------------- 工具 ---------------- */

/** 世界书条目一键去重（按 keys+content 指纹） */
export function dedupeEntries(entries: BookEntry[]): { entries: BookEntry[]; removed: number } {
  const seen = new Set<string>();
  const out: BookEntry[] = [];
  let removed = 0;
  for (const e of entries) {
    const sig = JSON.stringify([e.keys, e.secondary_keys, e.content]);
    if (seen.has(sig)) {
      removed++;
      continue;
    }
    seen.add(sig);
    out.push(e);
  }
  return { entries: out, removed };
}
