/**
 * 世界书激活引擎（ST world info 语义的确定性重实现）。
 *
 * 工作方式：对对话做逐楼回放（step = -1 表示空对话），每楼计算一次激活集与
 * 逐条目未激活原因；只返回最后一楼的结果。sticky/cooldown/delay 的状态由
 * 截止楼层数（deadline）推演，同 seed 同对话必得同结果。
 *
 * 语义依据：ST 官方文档（World Info 页）。文档未明确处标注「近似」：
 * - cooldown 截止自激活楼起算（ST 实为 sticky 到期后起算，近似）
 * - use_group_scoring 键评分降级为纯 groupWeight 权重选举
 * - 递归目标按"逐激活源内容"匹配（ST 为累积缓冲区整体扫描，近似但可归因）
 * - 预算按原文（宏展开前）计 token
 * - 正则脚本 placement=5（世界书）不参与扫描文本改写（M1 不支持）
 * - NOT_ANY/NOT_ALL 的 secondary 语义（全部命中才算失败 / 有未命中即通过）
 *   以文档为准，待真机样本校准
 *
 * 条目输入为扁平 WorldInfoEntry（core/lorebook/convert 的产物），外加
 * useRegex 旁路（BookEntry.use_regex 不在扁平模型里，由调用方携带）。
 */

import type { AnyCard, BookEntry } from '../card/schema';
import { embeddedToWiEntry, WI_LOGIC, type WorldInfoEntry } from '../lorebook/convert';
import { compileFindRegex } from '../regex/model';
import { countTokens } from '../stats/tokens';
import type { ChatState } from './chat';
import { worldInfoBudgetTokens, type StSettings } from './settings';
import type { Rng } from './rng';

export type WiSourceEntry = WorldInfoEntry & { useRegex?: boolean };

/* ---------------- trace 词汇表 ---------------- */

export type WiActivateReason =
  | { kind: 'constant' }
  | { kind: 'keyword'; matchedKeys: string[]; messageIndex: number }
  | { kind: 'recursive'; viaUid: number }
  | { kind: 'sticky' };

export type WiSkipReason =
  | { kind: 'disabled' }
  | { kind: 'vectorized' }
  | { kind: 'no-key-match' }
  | { kind: 'secondary-failed'; logic: number }
  | { kind: 'delayed'; needMessages: number }
  | { kind: 'cooldown'; remaining: number }
  | { kind: 'probability-failed'; roll: number; threshold: number }
  | { kind: 'group-lost'; winnerUid: number }
  | { kind: 'budget-dropped' }
  | { kind: 'delay-until-recursion' }
  | { kind: 'recursion-disabled' };

export type WiReason = WiActivateReason | WiSkipReason;

export interface WiEntryTrace {
  uid: number;
  comment: string;
  /** 蓝灯=constant，其余绿灯 */
  lamp: 'blue' | 'green';
  activated: boolean;
  reason: WiReason;
  matchedKeys: string[];
  position: number;
  depth: number;
  role: number;
  order: number;
  /** 原文内容 token 估算（宏展开前） */
  contentTokens: number;
}

export interface WiInjectionItem {
  entry: WorldInfoEntry;
  trace: WiEntryTrace;
}

export interface WiBookOverrides {
  scanDepth?: number | null;
  tokenBudget?: number | null;
  recursiveScanning?: boolean | null;
}

export interface WorldInfoRunResult {
  traces: WiEntryTrace[];
  /** 最终注入条目，全局按 order 降序（同 order 按 displayIndex 升序）；按锚点分组由组装器负责 */
  injections: WiInjectionItem[];
  /** 最后一楼默认扫描深度的窗口文本（透视展示用） */
  scanText: string;
  budgetTokens: number;
  usedTokens: number;
}

/* ---------------- 卡 → 引擎输入 ---------------- */

/** 卡内 character_book → 引擎条目（扁平 + useRegex 旁路） */
export function cardWorldInfoEntries(card: AnyCard): { entries: WiSourceEntry[]; book: WiBookOverrides } {
  const data = card.data as Record<string, unknown>;
  const book = data.character_book as
    | { entries?: BookEntry[]; scan_depth?: number | null; token_budget?: number | null; recursive_scanning?: boolean | null }
    | undefined;
  const entries = (book?.entries ?? []).map((e, i) => ({ ...embeddedToWiEntry(e, i), useRegex: e.use_regex === true }));
  return {
    entries,
    book: { scanDepth: book?.scan_depth ?? null, tokenBudget: book?.token_budget ?? null, recursiveScanning: book?.recursive_scanning ?? null },
  };
}

/* ---------------- 键匹配 ---------------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MatchOptions {
  caseSensitive: boolean;
  wholeWords: boolean;
}

function keyMatcher(key: string, text: string, e: WiSourceEntry, settings: StSettings, cache: Map<string, RegExp | null>): boolean {
  const k = key.trim();
  if (!k) return false;
  const caseSensitive = e.caseSensitive ?? settings.wiCaseSensitive;
  if (e.useRegex) {
    let re = cache.get(k);
    if (re === undefined) {
      try {
        re = compileFindRegex(k);
      } catch {
        re = null;
      }
      cache.set(k, re);
    }
    if (!re) return false;
    // compileFindRegex 恒为全局正则；.test() 受 lastIndex 状态影响，缓存跨条目/跨楼复用前必须复位
    re.lastIndex = 0;
    return re.test(text);
  }
  const wholeWords = e.matchWholeWords ?? settings.wiMatchWholeWords;
  if (wholeWords && /^[\w][\w-]*$/.test(k)) {
    // 整词只对拉丁词形键有意义；CJK 键无词边界概念，回退子串
    const re = new RegExp(`\\b${escapeRegExp(k)}\\b`, caseSensitive ? '' : 'i');
    return re.test(text);
  }
  const haystack = caseSensitive ? text : text.toLowerCase();
  return haystack.includes(caseSensitive ? k : k.toLowerCase());
}

function matchedKeys(keys: string[], text: string, e: WiSourceEntry, settings: StSettings, cache: Map<string, RegExp | null>): string[] {
  return keys.filter((k) => keyMatcher(k, text, e, settings, cache));
}

function secondaryKeysOk(e: WiSourceEntry, text: string, settings: StSettings, cache: Map<string, RegExp | null>): boolean {
  if (!e.keysecondary.length) return true;
  const sec = matchedKeys(e.keysecondary, text, e, settings, cache).length;
  switch (e.selectiveLogic) {
    case WI_LOGIC.AND_ALL:
      return sec === e.keysecondary.length;
    case WI_LOGIC.NOT_ANY:
      return sec === 0;
    case WI_LOGIC.NOT_ALL:
      return sec !== e.keysecondary.length;
    case WI_LOGIC.AND_ANY:
    default:
      return sec >= 1;
  }
}

function buildTrace(e: WiSourceEntry, activated: boolean, reason: WiReason, contentTokens: number): WiEntryTrace {
  return {
    uid: e.uid,
    comment: e.comment,
    lamp: e.constant ? 'blue' : 'green',
    activated,
    reason,
    matchedKeys: 'matchedKeys' in reason ? reason.matchedKeys : [],
    position: e.position,
    depth: e.depth,
    role: e.role,
    order: e.order,
    contentTokens,
  };
}

/* ---------------- 引擎主流程 ---------------- */

interface Activation {
  reason: WiActivateReason;
  matchedKeys: string[];
}

interface StepOutcome {
  activated: Map<number, Activation>;
  skips: Map<number, WiSkipReason>;
  scanText: string;
}

const byPriority = (a: WorldInfoEntry, b: WorldInfoEntry): number => b.order - a.order || a.displayIndex - b.displayIndex;

export function runWorldInfo(opts: {
  entries: WiSourceEntry[];
  chat: ChatState;
  settings: StSettings;
  rng: Rng;
  book?: WiBookOverrides;
}): WorldInfoRunResult {
  const { entries, chat, settings, rng } = opts;
  const book = opts.book ?? {};
  const messages = chat.messages;
  const totalSteps = messages.length;

  const scanDepthFor = (e: WiSourceEntry): number => Math.max(1, e.scanDepth ?? book.scanDepth ?? settings.wiScanDepth);
  const recursiveOn = book.recursiveScanning ?? settings.wiRecursiveScanning;
  const regexCache = new Map<string, RegExp | null>();

  /** uid → sticky/cooldown 截止楼（含）。激活于 step 则 sticky=N 覆盖 step..step+N */
  const deadline = new Map<number, { stickyUntil: number; cooldownUntil: number }>();

  /** 单楼管线：匹配 → 递归 → 组选举（预算在 finalize，无随机） */
  const runStep = (step: number): StepOutcome => {
    const soFar = step < 0 ? [] : messages.slice(0, step + 1);
    const windowTextFor = (depth: number): string =>
      soFar.slice(Math.max(0, soFar.length - depth)).map((m) => m.content).join('\n');
    // 条目未指定 scanDepth 时的默认窗口：书级 scan_depth 覆盖优先于全局设置
    const defaultWindow = windowTextFor(Math.max(1, book.scanDepth ?? settings.wiScanDepth));

    const activated = new Map<number, Activation>();
    const skips = new Map<number, WiSkipReason>();

    const activate = (e: WiSourceEntry, reason: WiActivateReason, keys: string[]): void => {
      activated.set(e.uid, { reason, matchedKeys: keys });
      skips.delete(e.uid);
      // sticky 维持激活不刷新截止楼（只有真实触发才重置），否则语义上永不失效
      if (reason.kind === 'sticky') return;
      const sticky = e.sticky ?? 0;
      const cooldown = e.cooldown ?? 0;
      if (sticky > 0 || cooldown > 0) {
        const prev = deadline.get(e.uid) ?? { stickyUntil: -1, cooldownUntil: -1 };
        deadline.set(e.uid, {
          stickyUntil: sticky > 0 ? step + sticky : prev.stickyUntil,
          cooldownUntil: cooldown > 0 ? step + cooldown : prev.cooldownUntil,
        });
      }
    };
    const timedBlocked = (e: WiSourceEntry): WiSkipReason | null => {
      const d = deadline.get(e.uid);
      if (d && d.cooldownUntil >= step) return { kind: 'cooldown', remaining: d.cooldownUntil - step + 1 };
      return null;
    };
    const probabilityPass = (e: WiSourceEntry): WiSkipReason | null => {
      if (!e.useProbability || e.probability >= 100) return null;
      const roll = rng();
      return roll < e.probability / 100 ? null : { kind: 'probability-failed', roll, threshold: e.probability };
    };

    /* ---- 基础扫描（数组序，保证 rng 消耗顺序确定） ---- */
    for (const e of entries) {
      if (e.disable) {
        skips.set(e.uid, { kind: 'disabled' });
        continue;
      }
      if (e.vectorized) {
        skips.set(e.uid, { kind: 'vectorized' });
        continue;
      }
      const dl = deadline.get(e.uid);
      if (dl && dl.stickyUntil >= step) {
        activate(e, { kind: 'sticky' }, []);
        continue;
      }
      const blocked = timedBlocked(e);
      if (blocked) {
        skips.set(e.uid, blocked);
        continue;
      }
      if (e.constant) {
        // 蓝灯：免扫描窗口直接激活（空对话也注入），不掷概率
        activate(e, { kind: 'constant' }, []);
        continue;
      }
      if (e.delayUntilRecursion) {
        skips.set(e.uid, recursiveOn ? { kind: 'delay-until-recursion' } : { kind: 'recursion-disabled' });
        continue;
      }
      if ((e.delay ?? 0) > 0 && soFar.length < e.delay!) {
        skips.set(e.uid, { kind: 'delayed', needMessages: e.delay! });
        continue;
      }
      const text = e.scanDepth != null ? windowTextFor(scanDepthFor(e)) : defaultWindow;
      const keys = matchedKeys(e.key, text, e, settings, regexCache);
      if (!keys.length) {
        skips.set(e.uid, { kind: 'no-key-match' });
        continue;
      }
      if (!secondaryKeysOk(e, text, settings, regexCache)) {
        skips.set(e.uid, { kind: 'secondary-failed', logic: e.selectiveLogic });
        continue;
      }
      const prob = probabilityPass(e);
      if (prob) {
        skips.set(e.uid, prob);
        continue;
      }
      activate(e, { kind: 'keyword', matchedKeys: keys, messageIndex: Math.max(0, step) }, keys);
    }

    /* ---- 递归扫描：逐激活源内容匹配（可归因），prevent/exclude/delayUntilRecursion 各司其职 ---- */
    if (recursiveOn) {
      let frontier = entries.filter((e) => activated.has(e.uid) && !e.preventRecursion);
      let steps = 0;
      const seeded = new Set<number>();
      while (frontier.length && steps < settings.wiMaxRecursionSteps) {
        const next: WiSourceEntry[] = [];
        for (const src of frontier) {
          if (seeded.has(src.uid)) continue;
          seeded.add(src.uid);
          for (const e of entries) {
            if (activated.has(e.uid) || e.disable || e.vectorized) continue;
            if (e.excludeRecursion) continue; // 不可被递归激活
            const blocked = timedBlocked(e);
            if (blocked) {
              skips.set(e.uid, blocked);
              continue;
            }
            const keys = matchedKeys(e.key, src.content, e, settings, regexCache);
            if (!keys.length) continue;
            if (!e.delayUntilRecursion && !secondaryKeysOk(e, src.content, settings, regexCache)) {
              skips.set(e.uid, { kind: 'secondary-failed', logic: e.selectiveLogic });
              continue;
            }
            const prob = probabilityPass(e);
            if (prob) {
              skips.set(e.uid, prob);
              continue;
            }
            activate(e, { kind: 'recursive', viaUid: src.uid }, keys);
            if (!e.preventRecursion) next.push(e);
          }
        }
        frontier = next;
        steps++;
      }
    }

    /* ---- 组选举：override 强制胜出，否则按 groupWeight 加权随机（use_group_scoring 降级为纯权重，近似） ---- */
    const groups = new Map<string, WiSourceEntry[]>();
    for (const e of entries) {
      if (!activated.has(e.uid) || !e.group) continue;
      const list = groups.get(e.group) ?? [];
      list.push(e);
      groups.set(e.group, list);
    }
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      const ordered = [...members].sort(byPriority);
      let winner = ordered.find((m) => m.groupOverride);
      if (!winner) {
        const totalWeight = ordered.reduce((s, m) => s + Math.max(0, m.groupWeight), 0);
        let r = rng() * totalWeight;
        for (const m of ordered) {
          r -= Math.max(0, m.groupWeight);
          if (r < 0) {
            winner = m;
            break;
          }
        }
        winner = winner ?? ordered[ordered.length - 1]!;
      }
      for (const m of ordered) {
        if (m.uid !== winner!.uid) {
          activated.delete(m.uid);
          skips.set(m.uid, { kind: 'group-lost', winnerUid: winner!.uid });
        }
      }
    }

    return { activated, skips, scanText: defaultWindow };
  };

  /* ---- 逐楼回放：空对话补一楼 step=-1（蓝灯仍激活） ---- */
  let outcome: StepOutcome = { activated: new Map(), skips: new Map(), scanText: '' };
  const stepsToRun = totalSteps > 0 ? totalSteps : 1;
  for (let i = 0; i < stepsToRun; i++) {
    outcome = runStep(totalSteps > 0 ? i : -1);
  }
  const { activated: finalActivated, skips: finalSkips, scanText: finalScanText } = outcome;

  /* ---- 预算填充（最后一楼激活集） ---- */
  const budgetTokens = worldInfoBudgetTokens(settings, book.tokenBudget);
  const activatedList = entries.filter((e) => finalActivated.has(e.uid));
  const tokensOf = new Map<number, number>();
  for (const e of entries) tokensOf.set(e.uid, countTokens(e.content).total);

  const kept = new Set<number>();
  let used = 0;
  const demoted: WiSourceEntry[] = [];
  for (const e of [...activatedList].sort(byPriority)) {
    const t = tokensOf.get(e.uid)!;
    if (e.ignoreBudget || used + t <= budgetTokens) {
      if (!e.ignoreBudget) used += t;
      kept.add(e.uid);
    } else {
      demoted.push(e);
    }
  }
  // MinActivations：无视预算按优先级回补
  for (const e of demoted) {
    if (kept.size >= settings.wiMinActivations) break;
    kept.add(e.uid);
  }

  const injections: WiInjectionItem[] = activatedList
    .filter((e) => kept.has(e.uid))
    .sort(byPriority)
    .map((e) => ({ entry: e, trace: buildTrace(e, true, finalActivated.get(e.uid)!.reason, tokensOf.get(e.uid)!) }));

  const traces = entries.map((e) => {
    const a = finalActivated.get(e.uid);
    if (a && kept.has(e.uid)) return buildTrace(e, true, a.reason, tokensOf.get(e.uid)!);
    const skip: WiSkipReason = a
      ? { kind: 'budget-dropped' }
      : (finalSkips.get(e.uid) ?? { kind: 'no-key-match' });
    return buildTrace(e, false, skip, tokensOf.get(e.uid)!);
  });

  return { traces, injections, scanText: finalScanText, budgetTokens, usedTokens: used };
}
