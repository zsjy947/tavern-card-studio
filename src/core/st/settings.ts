/**
 * ST 骨架参数（组装透视的"全局设置"层）。
 *
 * 定位：卡内视角模拟——只完整模拟卡驱动的部分（卡字段/卡内世界书/卡内正则）；
 * 酒馆全局项以 ST 默认值建模，全部可被 UI 覆盖。不解析 ST settings.json / preset
 * （明确不支持，见 ARCHITECTURE.md 的 core/st 章节）。
 *
 * 默认值出处：ST 官方文档（docs.sillytavern.app，World Info / Chat Composition 页）
 * 与 ST 出厂默认设置；文档未完全明确的项在注释中标「待真机样本校准」，先保守取值。
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface StSettings {
  /** 用户名（Persona 名，{{user}} 的取值） */
  userName: string;
  /** 主提示词（system，位于最前）。空串 = 不注入 */
  mainPrompt: string;
  /** NSFW 提示词（ST 出厂默认关闭，默认空） */
  nsfwPrompt: string;
  /** Post-History Instructions（jailbreak 位，位于对话历史之后）。空串 = 不注入 */
  phiPrompt: string;
  /** 用户人设描述（Persona Description）。空串 = 不注入 */
  userPersona: string;
  /** 作者注释：注入深度（距末端楼层数，ST 默认 4）+ 角色。content 空 = 不注入 */
  authorNote: { content: string; depth: number; role: ChatRole };
  /** 上下文大小（token），世界书预算按其百分比计算。ST 默认随 API 而异，取 8192（待真机样本校准） */
  contextSize: number;
  /** 世界书上下文预算百分比（ST 默认 25） */
  wiBudgetPercent: number;
  /** 世界书预算上限（token），0 = 不设上限（ST Budget Cap 默认 0） */
  wiBudgetCap: number;
  /** 世界书扫描深度（参与键匹配的最近消息条数，ST 默认 2；书内 scan_depth 可覆盖） */
  wiScanDepth: number;
  /** 最小激活条数（ST Min Activations 默认 0） */
  wiMinActivations: number;
  /** 递归扫描总开关（character_book.recursive_scanning 可覆盖） */
  wiRecursiveScanning: boolean;
  /** 最大递归步数（ST 默认 10） */
  wiMaxRecursionSteps: number;
  /** 键匹配大小写敏感（ST 默认关；条目级 caseSensitive 可覆盖） */
  wiCaseSensitive: boolean;
  /** 键匹配整词（ST 默认开；条目级 matchWholeWords 可覆盖） */
  wiMatchWholeWords: boolean;
}

export const ST_DEFAULT_SETTINGS: StSettings = {
  userName: 'User',
  mainPrompt: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
  nsfwPrompt: '',
  phiPrompt: '',
  userPersona: '',
  authorNote: { content: '', depth: 4, role: 'system' },
  contextSize: 8192,
  wiBudgetPercent: 25,
  wiBudgetCap: 0,
  wiScanDepth: 2,
  wiMinActivations: 0,
  wiRecursiveScanning: true,
  wiMaxRecursionSteps: 10,
  wiCaseSensitive: false,
  wiMatchWholeWords: true,
};

/** 世界书 token 预算：百分比 × 上下文大小，Budget Cap 收窄；书内 token_budget>0 直接取书值 */
export function worldInfoBudgetTokens(
  settings: Pick<StSettings, 'contextSize' | 'wiBudgetPercent' | 'wiBudgetCap'>,
  bookTokenBudget?: number | null,
): number {
  if (bookTokenBudget != null && bookTokenBudget > 0) return Math.floor(bookTokenBudget);
  const pct = Math.max(0, Math.min(100, settings.wiBudgetPercent));
  const budget = Math.floor((settings.contextSize * pct) / 100);
  return settings.wiBudgetCap > 0 ? Math.min(budget, settings.wiBudgetCap) : budget;
}
