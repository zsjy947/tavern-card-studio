/**
 * 顶层组装器：card + chat + settings + seed → 结构化组装结果（透视器的核心产出）。
 *
 * 消息序按 ST 文档默认序（chat completion）：
 *   主提示词 → 世界书·前置 → 用户人设 → 角色描述 → 性格 → 场景 → 世界书·后置
 *   → NSFW → 对话示例 → 对话历史（作者注释/世界书·深度注入按楼插队）→ 卡片 PHI → 全局 PHI
 * 顺序与形态细节以真机黄金样本仲裁（docs/st-golden-guide.md）；当前已知的保守近似：
 * - 对话示例不拆成 user/assistant 轮次，整段作单条 system（ST 会拆，待样本校准）
 * - 世界书 ANTop/ANBottom(2/3) 恒挂作者注释注入点（无作者注释时挂其默认深度）
 * - EMTop/EMBottom(5/6) 挂示例对话段前后；无示例段时挂历史前
 *
 * rng 消耗顺序固定：先世界书回放，再按段序宏展开——同 seed 全量重放一致。
 *
 * 其余已知近似（文档未明确 / 有意从简，待真机样本校准）：
 * - 历史中 role:'system' 的消息正则 placement 按 AI_OUTPUT 过滤（ChatState 类型
 *   允许 system 楼，当前 UI 不产出；若未来产出需补 placement 规则）
 * - {{time}}/{{date}} 默认取组装开始时刻（单次组装内一致）；跨时刻全量重放
 *   一致需调用方经 now 参数注入固定时间
 */

import { regexScriptSchema, type AnyCard, type RegexScript } from '../card/schema';
import { WI_POSITION, WI_ROLE } from '../lorebook/convert';
import { countTokens } from '../stats/tokens';
import { REGEX_PLACEMENT } from '../regex/model';
import { depthFromEnd, type ChatState } from './chat';
import { evaluateMacros, type MacroContext } from './macro';
import { mulberry32 } from './rng';
import { ST_DEFAULT_SETTINGS, type ChatRole, type StSettings } from './settings';
import { applyRegexPipeline, type RegexTraceItem } from './regex';
import { cardWorldInfoEntries, runWorldInfo, type WiEntryTrace, type WiInjectionItem } from './worldinfo';

export interface AssembledSegment {
  id: string;
  role: ChatRole;
  /** 机器可读来源：main-prompt / wi:{uid} / char-description / history:{i} / an / phi-card … */
  source: string;
  /** 中文标签（UI 展示） */
  label: string;
  content: string;
  tokens: number;
  estimated?: boolean;
}

export interface RegexPreview {
  messageIndex: number;
  raw: string;
  /** 渲染显示态（markdownOnly/无标记脚本） */
  display: string;
  /** 发送提示词态（promptOnly/无标记脚本） */
  prompt: string;
}

export interface AssembleResult {
  segments: AssembledSegment[];
  wiTraces: WiEntryTrace[];
  regexTraces: RegexTraceItem[];
  tokens: { total: number; bySource: Record<string, number>; estimated?: boolean };
  warnings: string[];
  seed: number;
  scanText: string;
  budgetTokens: number;
  regexPreview: RegexPreview | null;
}

function parseRegexScripts(card: AnyCard, warnings: string[]): RegexScript[] {
  const ext = (card.data as Record<string, unknown>).extensions as Record<string, unknown> | undefined;
  const raw = (ext?.regex_scripts as unknown[] | undefined) ?? [];
  const list: RegexScript[] = [];
  for (const s of raw) {
    const parsed = regexScriptSchema.safeParse(s);
    if (parsed.success) list.push(parsed.data);
    else warnings.push(`正则脚本无法解析已跳过：${(s as { scriptName?: string })?.scriptName ?? '(未命名)'}`);
  }
  return list;
}

const chatRoleOf = (r: number): ChatRole => (r === WI_ROLE.user ? 'user' : r === WI_ROLE.assistant ? 'assistant' : 'system');

export function assemblePrompt(
  card: AnyCard,
  chat: ChatState,
  settings: StSettings = ST_DEFAULT_SETTINGS,
  seed = 1234,
  /** {{time}}/{{date}} 的时间锚点；缺省取组装开始时刻，注入可实现跨时刻重放一致 */
  now = new Date(),
): AssembleResult {
  const data = card.data as Record<string, unknown>;
  const warnings: string[] = [];
  const vars: Record<string, unknown> = { ...chat.vars };
  const char = String(data.name ?? '');

  /* ---- 世界书先行（rng 消耗顺序固定） ---- */
  const rng = mulberry32(seed);
  const macroBase = (): MacroContext => ({ char, user: settings.userName, vars, rng, now });
  const { entries: wiEntries, book } = cardWorldInfoEntries(card);
  const wi = runWorldInfo({ entries: wiEntries, chat, settings, rng, book });

  /* ---- 宏展开（vars 顺序演化：setvar 对后续段可见） ---- */
  const expand = (raw: string): string => {
    const r = evaluateMacros(raw, macroBase());
    Object.assign(vars, r.vars);
    warnings.push(...r.warnings);
    return r.text;
  };

  const segments: AssembledSegment[] = [];
  const regexTraces: RegexTraceItem[] = [];
  let sid = 0;
  const push = (role: ChatRole, source: string, label: string, content: string): void => {
    if (!content || !content.trim()) return;
    const tk = countTokens(content);
    segments.push({ id: `s${sid++}`, role, source, label, content, tokens: tk.total, estimated: tk.estimated });
  };
  const expandPush = (role: ChatRole, source: string, label: string, raw: string): void => push(role, source, label, expand(raw));

  const wiLabel = (it: WiInjectionItem, prefix: string): string => `世界书·${prefix} ${it.entry.comment || `#${it.entry.uid}`}`;
  const pushWi = (it: WiInjectionItem, prefix: string, role?: ChatRole): void =>
    push(role ?? chatRoleOf(it.entry.role), `wi:${it.entry.uid}`, wiLabel(it, prefix), expand(it.entry.content));
  const wiAt = (position: number): WiInjectionItem[] => wi.injections.filter((it) => it.entry.position === position);

  /* ---- 主块序 ---- */
  expandPush('system', 'main-prompt', '主提示词', settings.mainPrompt);
  for (const it of wiAt(WI_POSITION.before)) pushWi(it, '前置');
  expandPush('system', 'persona', '用户人设', settings.userPersona);
  expandPush('system', 'char-description', '角色描述', String(data.description ?? ''));
  expandPush('system', 'char-personality', '角色性格', String(data.personality ?? ''));
  expandPush('system', 'scenario', '场景', String(data.scenario ?? ''));
  for (const it of wiAt(WI_POSITION.after)) pushWi(it, '后置');
  expandPush('system', 'nsfw', 'NSFW 提示词', settings.nsfwPrompt);

  /* ---- 示例对话 + EM 卫星 ---- */
  const mesExample = String(data.mes_example ?? '');
  const emQueue = [...wiAt(WI_POSITION.EMTop), ...wiAt(WI_POSITION.EMBottom)];
  if (mesExample.trim()) {
    for (const it of wiAt(WI_POSITION.EMTop)) pushWi(it, '示例前');
    expandPush('system', 'examples', '对话示例', mesExample);
    for (const it of wiAt(WI_POSITION.EMBottom)) pushWi(it, '示例后');
  }

  /* ---- 对话历史（正则 prompt 通路 + 宏展开） ---- */
  const scripts = parseRegexScripts(card, warnings);
  const historySegments: { role: ChatRole; source: string; label: string; content: string }[] = [];
  for (let i = 0; i < chat.messages.length; i++) {
    const m = chat.messages[i]!;
    const expanded = expand(m.content);
    const placement = m.role === 'user' ? REGEX_PLACEMENT.USER_INPUT : REGEX_PLACEMENT.AI_OUTPUT;
    const run = applyRegexPipeline(scripts, expanded, {
      placement,
      depthFromEnd: depthFromEnd(i, chat.messages.length),
      path: 'prompt',
      macroCtx: macroBase(),
    });
    warnings.push(...run.warnings);
    regexTraces.push(...run.traces);
    historySegments.push({ role: m.role, source: `history:${i}`, label: `历史 #${i + 1}`, content: run.text });
  }

  /* ---- 楼内注入：作者注释 + 世界书 ANTop/ANBottom(挂 AN 注入点) + atDepth ---- */
  const byCut = new Map<number, { role: ChatRole; source: string; label: string; content: string }[]>();
  const addTo = (cut: number, seg: { role: ChatRole; source: string; label: string; content: string }): void => {
    if (!seg.content.trim()) return;
    const list = byCut.get(cut) ?? [];
    list.push(seg);
    byCut.set(cut, list);
  };
  const historyLen = historySegments.length;
  const anDepth = Math.max(0, Math.floor(settings.authorNote.depth));
  const anCut = Math.min(historyLen, Math.max(0, historyLen - anDepth));
  const atDepthItems = wiAt(WI_POSITION.atDepth);
  // 同一注入点内顺序：ANTop → 作者注释 → ANBottom → atDepth（atDepth 各归其楼）
  for (const it of wiAt(WI_POSITION.ANTop)) {
    const seg = { role: chatRoleOf(it.entry.role), source: `wi:${it.entry.uid}`, label: wiLabel(it, '作者注释上'), content: expand(it.entry.content) };
    addTo(anCut, seg);
  }
  if (settings.authorNote.content.trim()) {
    addTo(anCut, {
      role: settings.authorNote.role,
      source: 'an',
      label: `作者注释 @深度${anDepth}`,
      content: expand(settings.authorNote.content),
    });
  }
  for (const it of wiAt(WI_POSITION.ANBottom)) {
    const seg = { role: chatRoleOf(it.entry.role), source: `wi:${it.entry.uid}`, label: wiLabel(it, '作者注释下'), content: expand(it.entry.content) };
    addTo(anCut, seg);
  }
  for (const it of atDepthItems) {
    const depth = Math.max(0, Math.floor(it.entry.depth));
    const cut = Math.min(historyLen, Math.max(0, historyLen - depth));
    addTo(cut, { role: chatRoleOf(it.entry.role), source: `wi:${it.entry.uid}`, label: wiLabel(it, `深度注入 @${depth}`), content: expand(it.entry.content) });
  }
  // 无示例段时 EM 条目挂历史最前
  if (!mesExample.trim()) {
    const lead = emQueue.map((it) => ({ role: chatRoleOf(it.entry.role), source: `wi:${it.entry.uid}`, label: wiLabel(it, '示例位'), content: expand(it.entry.content) }));
    for (const seg of lead) addTo(0, seg);
  }

  const chatArr = [...historySegments];
  for (const cut of [...byCut.keys()].sort((a, b) => b - a)) {
    chatArr.splice(cut, 0, ...(byCut.get(cut) ?? []));
  }
  for (const seg of chatArr) {
    const tk = countTokens(seg.content);
    segments.push({ id: `s${sid++}`, role: seg.role, source: seg.source, label: seg.label, content: seg.content, tokens: tk.total, estimated: tk.estimated });
  }

  expandPush('system', 'phi-card', '卡片 PHI', String(data.post_history_instructions ?? ''));
  expandPush('system', 'phi-global', '全局 PHI（Jailbreak）', settings.phiPrompt);

  /* ---- 汇总 ---- */
  let total = 0;
  const bySource: Record<string, number> = {};
  let estimated = false;
  for (const s of segments) {
    total += s.tokens;
    bySource[s.source] = (bySource[s.source] ?? 0) + s.tokens;
    if (s.estimated) estimated = true;
  }

  /* ---- 末条 AI 消息的显示态对照（正则双通路可视化） ---- */
  let regexPreview: RegexPreview | null = null;
  const lastAiIdx = chat.messages.map((m) => m.role).lastIndexOf('assistant');
  if (lastAiIdx >= 0) {
    const raw = chat.messages[lastAiIdx]!.content;
    const disp = applyRegexPipeline(scripts, raw, {
      placement: REGEX_PLACEMENT.MD_DISPLAY,
      path: 'display',
      macroCtx: macroBase(),
    });
    warnings.push(...disp.warnings);
    regexTraces.push(...disp.traces);
    const promptSeg = segments.find((s) => s.source === `history:${lastAiIdx}`);
    regexPreview = { messageIndex: lastAiIdx, raw, display: disp.text, prompt: promptSeg?.content ?? '' };
  }

  return {
    segments,
    wiTraces: wi.traces,
    regexTraces,
    tokens: { total, bySource, estimated },
    warnings: [...new Set(warnings)],
    seed,
    scanText: wi.scanText,
    budgetTokens: wi.budgetTokens,
    regexPreview,
  };
}
