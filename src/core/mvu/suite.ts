/**
 * MVU 13 件套一键注入：2 脚本 + 5（或 4+N 拆分）世界书条目 + 4 正则 + 开场白占位符。
 *
 * 注入配置对齐 MVU 框架约定（MagVarUpdate 教程）：
 * - 世界书条目统一 extensions.position=4（at depth）、depth=0、order=200、prevent/exclude 双禁递归
 * - [initvar] 条目为禁用态（框架仍会读取）
 * - 4 正则注入顺序：更新中 → 完整 → 只发 N 楼（promptOnly，minDepth=N×2）→ 界面占位符
 * 全部操作幂等：已有 MVU 时先清理后注入，重复执行不叠加。
 */
import type { AnyCard, BookEntry, MvuVarGroup, RegexScript, TavernHelperScript } from '../card/schema';
import { newRegexScript } from '../regex/model';
import {
  MVU_BUNDLE_IMPORT,
  MVU_INITVAR_COMMENT,
  MVU_OUTPUT_EMPHASIS_TEXT,
  MVU_OUTPUT_FORMAT_TEXT,
  MVU_PLACEHOLDER,
  MVU_SCRIPT_BUTTONS,
  MVU_VARIABLE_LIST_TEXT,
  MVU_ALWAYS_ON_GROUPS,
  buildInitVarYaml,
  buildUpdateRuleText,
  buildZodCode,
  mvuGroupEntryComment,
  mvuGroupEntryContent,
} from './model';

export interface MvuSuiteConfig {
  /** 整体注入（一条变量列表）或按分组拆分（每组一条，省 token） */
  injectMode: 'whole' | 'split';
  /** 保留最近 N 楼变量更新发回 AI（正则 minDepth = N×2） */
  keepFloors: number;
  /** 在场角色追踪（自动加变量 + check 规则） */
  trackPresentChars: boolean;
}

export const MVU_DEFAULT_CONFIG: MvuSuiteConfig = {
  injectMode: 'whole',
  keepFloors: 3,
  trackPresentChars: false,
};

export interface MvuSuite {
  scripts: TavernHelperScript[];
  entries: BookEntry[];
  regexes: RegexScript[];
  /** 需要追加到 first_mes 与所有 alternate_greetings 末尾的占位符 */
  placeholder: string;
}

/** MVU 关键词组（幂等清理/检测依据） */
export const MVU_KEYWORDS = [
  '变量更新规则', '变量输出格式', '变量输出格式强调', '当前变量值',
  '变量初始化', '变量列表', 'Zod Schema', 'MVU 变量系统', 'MVUbeta',
];
export const MVU_REGEX_KEYWORDS = ['变量更新中', '完整变量完成', '变量更新', '界面占位符'];

const PLACEHOLDER_RE = /\n?<StatusPlaceHolderImpl\s*\/>/g;

/** 检测卡内是否已有 MVU 套装（世界书条目 / 脚本名 / 正则名任一命中） */
export function detectExistingMvu(card: AnyCard): boolean {
  const data = card.data as Record<string, unknown>;
  const ext = (data.extensions ?? {}) as Record<string, unknown>;
  const entries = ((data.character_book as { entries?: { comment?: string }[] } | undefined)?.entries ?? []).map((e) => e.comment ?? '');
  const scripts = ((ext.TavernHelper_scripts as { name?: string }[] | undefined) ?? []).map((s) => s.name ?? '');
  const regexes = ((ext.regex_scripts as { scriptName?: string }[] | undefined) ?? []).map((s) => s.scriptName ?? '');
  return (
    entries.some((c) => MVU_KEYWORDS.some((k) => c.includes(k))) ||
    scripts.some((n) => MVU_KEYWORDS.some((k) => n.includes(k))) ||
    regexes.some((n) => MVU_REGEX_KEYWORDS.some((k) => n.includes(k)))
  );
}

/** 从卡内剥离全部 MVU 内容（条目/脚本/正则/开场白占位符/变量组数据），返回新卡不改原卡 */
export function removeExistingMvu(card: AnyCard): AnyCard {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  const ext = (data.extensions ?? {}) as Record<string, unknown>;

  const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] };
  book.entries = book.entries.filter((e) => !MVU_KEYWORDS.some((k) => (e.comment ?? '').includes(k)));
  data.character_book = book;

  const scripts = (ext.TavernHelper_scripts as TavernHelperScript[] | undefined) ?? [];
  ext.TavernHelper_scripts = scripts.filter((s) => !MVU_KEYWORDS.some((k) => (s.name ?? '').includes(k)));

  const regexes = (ext.regex_scripts as RegexScript[] | undefined) ?? [];
  ext.regex_scripts = regexes.filter((s) => !MVU_REGEX_KEYWORDS.some((k) => (s.scriptName ?? '').includes(k)));

  data.extensions = ext;

  if (typeof data.first_mes === 'string') data.first_mes = data.first_mes.replace(PLACEHOLDER_RE, '');
  if (Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings = (data.alternate_greetings as string[]).map((g) => g.replace(PLACEHOLDER_RE, ''));
  }
  delete ext.tcsMvuVarGroups;
  return next;
}

/** MVU 世界书条目通用配置：position=4 / depth=0 / order / 双禁递归 */
function applyEntryConfig(entry: BookEntry, opts: { constant?: boolean; enabled?: boolean; order?: number } = {}): BookEntry {
  entry.constant = opts.constant ?? true;
  entry.enabled = opts.enabled ?? true;
  entry.insertion_order = opts.order ?? 200;
  entry.position = 'before_char'; // at depth 形态以 extensions.position=4 为准（互转保留原值）
  entry.extensions = {
    ...(entry.extensions ?? {}),
    position: 4,
    depth: 0,
    prevent_recursion: true,
    exclude_recursion: true,
    probability: 100,
    useProbability: true,
  };
  return entry;
}

/**
 * 构建 MVU 13 件套（不落卡）。baseEntryId 用于协调卡内既有世界书 id 空间。
 * @param zodCode 变量设计器生成的 Zod Schema 代码（由 buildZodCode 产出）
 */
export function buildMvuSuite(
  card: AnyCard,
  groups: MvuVarGroup[],
  zodCode: string,
  config: MvuSuiteConfig = MVU_DEFAULT_CONFIG,
): MvuSuite {
  const data = card.data as Record<string, unknown>;
  const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] };
  let entryId = book.entries.reduce((mx, e) => Math.max(mx, Number(e.id ?? -1)), -1) + 1;

  const minDepth = Math.max(1, config.keepFloors) * 2;

  /* ---- 脚本 ×2 ---- */
  const scripts: TavernHelperScript[] = [
    {
      id: `ths_mvu_bundle_${stamp()}`,
      name: 'MVU 变量系统',
      comment: 'MVU 变量框架（MagVarUpdate）。需酒馆助手扩展；按钮组见 button 字段',
      type: 'inline',
      enabled: true,
      autoRun: true,
      event: '',
      content: MVU_BUNDLE_IMPORT,
      button: { enabled: true, buttons: MVU_SCRIPT_BUTTONS.map((b) => ({ ...b })) },
    },
    {
      id: `ths_mvu_zod_${stamp()}`,
      name: 'Zod Schema',
      comment: 'MVU 变量结构校验（registerMvuSchema）',
      type: 'inline',
      enabled: true,
      autoRun: true,
      event: '',
      content: zodCode,
    },
  ];

  /* ---- 世界书条目（initvar + 变量列表 + 更新规则 + 输出格式 + 强调）---- */
  const entries: BookEntry[] = [];
  const mkEntry = (comment: string, content: string, opts?: Parameters<typeof applyEntryConfig>[1]): BookEntry => {
    const entry: BookEntry = {
      id: entryId++,
      keys: [],
      secondary_keys: [],
      comment,
      content,
      constant: true,
      selective: false,
      insertion_order: 200,
      enabled: true,
      position: 'before_char',
      use_regex: false,
      extensions: {},
    };
    return applyEntryConfig(entry, opts);
  };

  // [initvar]：禁用态（框架仍读取），内容为变量初值 YAML
  entries.push(mkEntry(MVU_INITVAR_COMMENT, buildInitVarYaml(groups, config), { constant: false, enabled: false }));

  // 变量列表：整体注入一条，或按分组拆分（世界/系统/环境/主角恒蓝灯，其余绿灯 keys=[组名]，order 190 起）
  if (config.injectMode === 'split') {
    let orderBase = 190;
    for (const group of groups) {
      if (!group.name) continue;
      const alwaysOn = MVU_ALWAYS_ON_GROUPS.includes(group.name);
      const e = mkEntry(mvuGroupEntryComment(group.name), mvuGroupEntryContent(group.name), {
        constant: alwaysOn,
        order: orderBase++,
      });
      if (!alwaysOn) e.keys = [group.name];
      entries.push(e);
    }
  } else {
    entries.push(mkEntry('变量列表', MVU_VARIABLE_LIST_TEXT));
  }

  entries.push(mkEntry('[mvu_update]变量更新规则', buildUpdateRuleText(groups, config)));
  entries.push(mkEntry('[mvu_update]变量输出格式', MVU_OUTPUT_FORMAT_TEXT));
  entries.push(mkEntry('[mvu_update]变量输出格式强调', MVU_OUTPUT_EMPHASIS_TEXT));

  /* ---- 正则 ×4（顺序：更新中 → 完整 → 只发 N 楼 → 界面占位符）---- */
  const regexes: RegexScript[] = [
    // 流式传输中的未闭合块（负向前瞻）→ 展开面板
    newRegexScript({
      id: `rx_mvu_streaming_${stamp()}`,
      scriptName: '[美化]变量更新中',
      findRegex: '/<UpdateVariable>(?![\\s\\S]*<\\/UpdateVariable>)([\\s\\S]*)/gs',
      replaceString:
        '<details open style="background:rgba(0,0,0,0.15);border:1px solid rgba(100,200,255,0.15);border-radius:6px;padding:8px;margin:4px 0;font-size:12px"><summary style="cursor:pointer;color:#60a5fa">变量更新中...</summary><pre style="white-space:pre-wrap;color:#aaa;margin:4px 0">$1</pre></details>',
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
    }),
    // 闭合块 → 折叠面板
    newRegexScript({
      id: `rx_mvu_done_${stamp()}`,
      scriptName: '[美化]完整变量完成',
      findRegex: '/<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gs',
      replaceString:
        '<details style="background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px;margin:4px 0;font-size:12px"><summary style="cursor:pointer;color:#888">变量更新</summary><pre style="white-space:pre-wrap;color:#aaa;margin:4px 0">$1</pre></details>',
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
    }),
    // 只发最新 N 楼：promptOnly + minDepth=N×2，防重复更新灌爆上下文
    newRegexScript({
      id: `rx_mvu_trim_${stamp()}`,
      scriptName: `只发送最新${config.keepFloors}楼的变量更新`,
      findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
      replaceString: '',
      placement: [2],
      markdownOnly: false,
      promptOnly: true,
      minDepth: minDepth,
      runOnEdit: false,
    }),
    // 界面占位符不发给 AI
    newRegexScript({
      id: `rx_mvu_ph_${stamp()}`,
      scriptName: '[不发送]界面占位符',
      findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g',
      replaceString: '',
      placement: [2],
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
    }),
  ];

  return { scripts, entries, regexes, placeholder: MVU_PLACEHOLDER };
}

/**
 * 把套装应用进卡（幂等：已有 MVU 先清理）。返回新卡，不修改原卡。
 * 变量组定义持久化到 extensions.tcsMvuVarGroups。
 */
export function applyMvuToCard(card: AnyCard, groups: MvuVarGroup[], zodCode: string, config: MvuSuiteConfig = MVU_DEFAULT_CONFIG): AnyCard {
  const cleaned = removeExistingMvu(card);
  const data = cleaned.data as Record<string, unknown>;
  const ext = (data.extensions ?? {}) as Record<string, unknown>;

  const suite = buildMvuSuite(cleaned, groups, zodCode, config);

  ext.TavernHelper_scripts = [...((ext.TavernHelper_scripts as TavernHelperScript[] | undefined) ?? []), ...suite.scripts];
  ext.regex_scripts = [...((ext.regex_scripts as RegexScript[] | undefined) ?? []), ...suite.regexes];
  data.extensions = ext;

  const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] };
  book.entries = [...book.entries, ...suite.entries];
  data.character_book = book;

  // 变量组定义持久化（换机/导卡不丢设计源）
  ext.tcsMvuVarGroups = JSON.parse(JSON.stringify(groups));

  // 开场白占位符（幂等追加）
  if (typeof data.first_mes === 'string' && !data.first_mes.includes('StatusPlaceHolderImpl')) {
    data.first_mes = `${data.first_mes}\n${suite.placeholder}`;
  }
  if (Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings = (data.alternate_greetings as string[]).map((g) =>
      g.includes('StatusPlaceHolderImpl') ? g : `${g}\n${suite.placeholder}`,
    );
  }
  return cleaned;
}

/** [不发送]界面占位符 正则的固定名（三方校验等场景引用） */
export const MVU_PLACEHOLDER_REGEX_NAME = '[不发送]界面占位符';

function stamp(): string {
  return Date.now().toString(36);
}
