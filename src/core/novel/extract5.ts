/**
 * 小说转世界书 —— 5 类轨迹分步提取引擎（角色 / 事件线 / 时间线 / 设定 / 物品轨迹）。
 *
 * 设计借鉴 CardForge（GPL-3.0）的 5 类分步提取思路，本文件为独立实现（未复制源码）：
 * - 每类独立 AI 调用（逐片 × 逐类），各类 prompt 只关注单一任务
 * - 写作铁律：白描 / 八股化禁令 / 章节号锚定 / 关系行为禁抽象标签 / 事件线四值
 * - 主角双模式：replace（{{user}} 替代小说主角）/ npc（主角作为 NPC 完整成条目）
 * - 物品轨迹只存「获得/消耗」事件，不存当前持有快照（RP 时按章节动态判定）
 * - extractionToWorldEntries 蓝绿灯自动分配 + 朔递归规则
 *
 * 纯函数模块：prompt 组装、切片、结果归一化、条目转换均可单测。
 */

/* ------------------------------------------------------------------ */
/* 类型与配置                                                           */
/* ------------------------------------------------------------------ */

export type ExtractType = 'character' | 'eventline' | 'timeline' | 'setting' | 'item_trajectory';
export type ProtagonistMode = 'replace' | 'npc';

export const EXTRACT_TYPES: { key: ExtractType; label: string; desc: string }[] = [
  { key: 'character', label: '角色', desc: '5 种轨迹（境界/位置/物品/关系/行为模式）' },
  { key: 'eventline', label: '事件线', desc: '主线/支线/暗线/伏笔，含起因/经过/结果' },
  { key: 'timeline', label: '时间线', desc: '阶段 + 时间标记 + 境界状态' },
  { key: 'setting', label: '设定', desc: '功法/丹药/地理/势力/世界观常识' },
  { key: 'item_trajectory', label: '物品轨迹', desc: '只存获得/消耗章节，不存当前持有' },
];

/** 筛选上限（0 = 不限） */
export const FILTER_LIMITS = {
  minorCharacters: 15,
  sideStorylinesTotal: 10,
  techniques: 10,
  pills: 10,
  geoFactions: 10,
  worldviewPerSubsystem: 1,
} as const;

export interface ExtractConfig {
  novelName: string;
  /** 篇章名（条目标题前缀） */
  chapterName: string;
  protagonistName: string;
  userMode: ProtagonistMode;
  /** 切片策略：auto（章节优先，不足 3 章回退字数）/ chapter / words */
  chunkStrategy: 'auto' | 'chapter' | 'words';
  chaptersPerChunk: number;
  wordsPerChunk: number;
  selectedTypes: ExtractType[];
}

export const DEFAULT_EXTRACT_CONFIG: ExtractConfig = {
  novelName: '',
  chapterName: '',
  protagonistName: '',
  userMode: 'replace',
  chunkStrategy: 'auto',
  chaptersPerChunk: 5,
  wordsPerChunk: 10000,
  selectedTypes: ['character', 'eventline', 'timeline', 'setting', 'item_trajectory'],
};

/** 一次完整提取的聚合状态（工坊 pipelineState / 编辑器面板共用） */
export interface NovelExtraction {
  characters: ExtractedCharacter[];
  eventlines: ExtractedEventline[];
  timeline: ExtractedTimelineStage[];
  settings: ExtractedSetting[];
  item_trajectories: ExtractedItem[];
}

export interface ExtractedCharacter {
  name: string;
  role: 'major' | 'minor';
  first_chapter: string;
  last_chapter: string;
  basic: Record<string, string>;
  appearance: string;
  tracks: {
    境界: { chapter: string; state: string; evidence?: string }[];
    位置: { chapter: string; location: string }[];
    物品: { chapter: string; action: string; item: string; source?: string; destination?: string }[];
    关系: {
      target: string;
      behaviors: { chapter: string; behavior: string; context?: string }[];
      summary?: string;
      boundary?: string;
    }[];
    行为模式: { stage: string; range: string; dialogues: string[]; decisions?: string }[];
  };
}

export interface ExtractedEventline {
  name: string;
  type: '主线' | '支线' | '暗线' | '伏笔';
  cause: { chapter: string; summary?: string; dialogue?: string } | null;
  passages: { chapter: string; node: string; location?: string; key_characters?: string[]; dialogue?: string }[];
  result: { chapter: string; summary?: string; dialogue?: string } | null;
  follow_up: string;
}

export interface ExtractedTimelineStage {
  stage_name: string;
  chapter_range: string;
  time_markers: { chapter: string; raw: string; annotation?: string }[];
  summary: string;
  protagonist_status: string;
}

export interface ExtractedSetting {
  subtype: '功法' | '丹药' | '地理' | '势力' | '世界观常识';
  name: string;
  level?: string;
  grade?: string;
  user?: string;
  refiner?: string;
  first_chapter: string;
  effect?: string;
  description?: string;
}

export interface ExtractedItem {
  item_name: string;
  owner: string;
  events: { chapter: string; action: '获得' | '消耗' | '转赠'; source?: string; destination?: string; evidence?: string }[];
}

export function emptyExtraction(): NovelExtraction {
  return { characters: [], eventlines: [], timeline: [], settings: [], item_trajectories: [] };
}

/* ------------------------------------------------------------------ */
/* 写作铁律 + 主角模式规则（各类共用，注入 system）                      */
/* ------------------------------------------------------------------ */

export const WRITING_RULES = `## 写作铁律（必须严格遵守）

### 一、白描手法
- 客观叙述，不带主观判断；用具体行为代替抽象描述
- 「她很温柔」✗ → 「遇到受伤的小动物会带回家照顾」✓
- 用语料展现性格；不堆砌无意义形容词

### 二、八股化禁令
- 禁模糊词：似乎、几乎、仿佛、宛如、好像
- 禁八股微表情：嘴角微微上扬、眼里闪过一丝XX
- 禁语气描写套路：带着xx的口吻、用xx的语气
- 禁否定转折句式「不是…而是…」；禁性格标签（「她很温柔」「他很善良」）
- 禁万能美人描写：精致的脸蛋、白皙的皮肤、桃花眼、柳叶眉

### 三、章节号锚定（必须）
- 所有事实必须标注章节号；原文有「第X章/话/节」→ 统一写「第X章」
- 无明确章节标题 → 写「未明确章节」；禁止凭空虚构章节号

### 四、关系/行为禁标签
- 禁抽象标签（「深爱、忠诚、百依百顺」），必须写「该角色在第X章做了什么」
- 例：✗「深爱主角」→ ✓「第10章主动借钱不要求归还、第52章趁对方睡着输送灵力」

### 五、事件线类型限定
- 事件线类型仅四值：主线 / 支线 / 暗线 / 伏笔，禁止自定义类型

### 六、中文引号规则（防 JSON 解析炸裂）
- 所有 JSON 字符串值内的引用、引语、书名号一律使用中文引号「」『』《》，禁止英文双引号 "`;

export function buildProtagonistRule(mode: ProtagonistMode, protagonistName: string): string {
  const name = protagonistName || '(主角名未指定)';
  if (mode === 'replace') {
    return `## 主角处理（{{user}} 替代小说主角）
- 小说原文里的「${name}」= {{user}}（玩家代入主角）
- 所有「角色对主角的关系」写成「对 {{user}} 的关系」
- 主角本身不单独成条目；角色条目里写「与 {{user}} 的关系：[具体行为+章节号]」`;
  }
  return `## 主角处理（主角作为 NPC）
- 小说原文里的「${name}」作为 NPC 写完整条目（含 5 种轨迹）
- {{user}} 不出现在提取结果里（玩家在酒馆自行定义身份）
- 所有角色关系按原文写（如「对${name}的态度」），不要改写成「对 {{user}}」`;
}

/* ------------------------------------------------------------------ */
/* 5 类提取 prompt（system 骨架 + 输出结构说明）                        */
/* ------------------------------------------------------------------ */

const PROMPTS: Record<ExtractType, string> = {
  character: `## 任务：提取小说中的角色（按 5 种轨迹）

角色分级：
- 重要角色（major）：出场 ≥ 5 章 + 与主角有具体互动 + 出现在事件线经过节点（不限量）
- 次要角色（minor）：出场 ≥ 3 章，或在事件线经过节点出现，或与主角有具体互动（上限 ${FILTER_LIMITS.minorCharacters} 条，按重要性取前 ${FILTER_LIMITS.minorCharacters}）
- 路人：不收录

输出 JSON 数组，每个元素：
{"name":"角色名","role":"major|minor","first_chapter":"第X章","last_chapter":"第Y章",
 "basic":{"身份":"…","年龄":"…","性别":"…"},
 "appearance":"只写偏离默认认知的外貌（禁万能美人描写）",
 "tracks":{
   "境界":[{"chapter":"第X章","state":"按原作等级体系","evidence":"原文摘录"}],
   "位置":[{"chapter":"第X章","location":"地点"}],
   "物品":[{"chapter":"第X章","action":"获得","item":"物品名","source":"来源"}],
   "关系":[{"target":"对方","behaviors":[{"chapter":"第X章","behavior":"具体行为","context":"语境短句"}],"summary":"互动特征（禁抽象标签）","boundary":"原著明确没发展到的程度"}],
   "行为模式":[{"stage":"阶段名","range":"第1-10章","dialogues":["原文台词（含章节号）"],"decisions":"具体决策倾向"}]
 }}`,
  eventline: `## 任务：提取小说事件线

类型仅四值：主线 / 支线 / 暗线 / 伏笔。
- 主线：全部保留
- 支线+暗线+伏笔：合计上限 ${FILTER_LIMITS.sideStorylinesTotal} 条（标准：经过节点 ≥ 2 + 涉及至少一个重要角色 + 有后续影响）

输出 JSON 数组，每个元素：
{"name":"事件线名","type":"主线|支线|暗线|伏笔",
 "cause":{"chapter":"第X章","summary":"起因一句话","dialogue":"代表性台词"},
 "passages":[{"chapter":"第X章","node":"节点描述","location":"地点","key_characters":["角色"],"dialogue":"代表性台词"}],
 "result":{"chapter":"第X章","summary":"结果一句话","dialogue":"代表性台词"},
 "follow_up":"对后续的伏笔/影响（无则空字符串）}"`,
  timeline: `## 任务：提取小说时间线主干

按阶段切分。时间标记只收「含具体数字的已发生事实距离」（X年/X月/X天/X岁）或主角当前年龄；
不收：未来预测、约定、纯世界观历史、他人年龄推测。

输出 JSON 数组，每个元素：
{"stage_name":"阶段名","chapter_range":"第1-15章",
 "time_markers":[{"chapter":"第X章","raw":"原文时间表述","annotation":"推算说明"}],
 "summary":"100字以内概括",
 "protagonist_status":"本阶段结束时主角状态（按原作等级体系）"}`,
  setting: `## 任务：提取世界观设定（严格筛选）

- 功法/斗技：上限 ${FILTER_LIMITS.techniques}（主角使用 ≥ 2 次或主线关键）
- 丹药：上限 ${FILTER_LIMITS.pills}（同上）
- 地理/势力：合计上限 ${FILTER_LIMITS.geoFactions}（原文反复提及 ≥ 3 次）
- 世界观常识：每子系统（境界/货币/职业体系等）1 条说清

输出 JSON 数组，subtype 严格五值：功法/丹药/地理/势力/世界观常识。每个元素：
{"subtype":"功法","name":"名称","level":"等级","grade":"品级","user":"使用者","refiner":"炼制者","first_chapter":"第X章","effect":"效果","description":"描述"}
（level/grade/user/refiner/effect 仅在有意义时填）`,
  item_trajectory: `## 任务：提取物品流转轨迹

只追踪对主角或核心剧情有意义的物品；不追踪消耗品、低价值物品（金币）、纯设定物品。
**关键：只存「获得章节」与「消耗章节」，不存当前持有快照**——
RP 时按当前章节 N 动态判定：获得章节 ≤ N 且无消耗记录 → 持有。

输出 JSON 数组，每个元素：
{"item_name":"物品名","owner":"持有者",
 "events":[{"chapter":"第X章","action":"获得|消耗|转赠","source":"来源","destination":"去向","evidence":"原文摘录"}]}
action 严格三值：获得 / 消耗 / 转赠`,
};

/** 组装单类提取 system prompt（铁律 + 主角模式 + 类任务） */
export function buildExtractSystemPrompt(type: ExtractType, config: ExtractConfig): string {
  return `${PROMPTS[type]}\n\n${WRITING_RULES}\n\n${buildProtagonistRule(config.userMode, config.protagonistName)}\n\n只输出 JSON 数组，不要其他文字。`;
}

/** 组装单类提取 user prompt（切片文本 + 衔接上下文） */
export function buildExtractUserPrompt(type: ExtractType, chunk: string, prevSummary?: string): string {
  const parts = [
    prevSummary ? `【前文衔接摘要（保持跨片一致）】\n${prevSummary}` : '',
    `【原文片段】\n${chunk}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** 提示词库（builtins）用：5 类提取 + 自检的 target/系统提示词对 */
export function builtinExtract5PromptPayloads(): { target: string; name: string; system: string; userTemplate: string }[] {
  const labelOf = (k: ExtractType): string => EXTRACT_TYPES.find((t) => t.key === k)!.label;
  const rows = (Object.keys(PROMPTS) as ExtractType[]).map((k) => ({
    target: `novel:extract5-${k}`,
    name: `小说提取 · ${labelOf(k)}`,
    system: `${PROMPTS[k]}\n\n${WRITING_RULES}`,
    userTemplate: '【前文衔接摘要（可选）】\n{PREV}\n\n【原文片段】\n{CHUNK}',
  }));
  rows.push({
    target: 'novel:extract5-selfcheck',
    name: '小说提取 · 自检修正',
    system: SELF_CHECK_PROMPT,
    userTemplate: '【上一步提取结果】\n{RESULT}',
  });
  return rows;
}

/** AI 自检 prompt（每类提取完成后调用一次，四项修正） */
export const SELF_CHECK_PROMPT = `## 任务：自检并修正上一步提取结果

逐条检查修正：
1. 章节号锚定：每个事实是否标了章节号？无章节标题的应写「未明确章节」，禁止编造
2. 关系/行为标签化：「温顺乖巧」「嫉妒驱动」等抽象标签 → 改成具体行为+章节号
3. 八股化：「似乎/仿佛/嘴角微微上扬/她很温柔」→ 改成白描
4. 万能美人描写：「精致脸蛋/白皙皮肤」→ 改成具体特征或删除
5. 事件线类型：非四值类型（如「人物关系变化线」）→ 强制归到主线/支线/暗线/伏笔之一
6. 台词归属：每条台词的说话人是否确为该角色本人

输出修正后的完整 JSON 数组（字段结构不变），不要输出修订过程，不要其他文字。`;

/* ------------------------------------------------------------------ */
/* 章节切片：章节优先（≥3 章成组），字数 fallback（句号断尾）            */
/* ------------------------------------------------------------------ */

const CHUNK_HEAD_RE =
  /^\s*(?:第[一二三四五六七八九十百千万零〇两\d]+[章回节卷幕折话]|Chapter\s+\d+|Episode\s+\d+|Part\s+\d+|Scene\s+\d+|序章|序幕|楔子|引子|尾声|终章|Prologue|Epilogue)/im;

export interface NovelChunk {
  text: string;
  strategy: 'chapter' | 'words';
  /** 章节模式下的章节范围描述（如 第1-5章）；words 模式为空 */
  range: string;
}

export interface ChunkResult {
  strategy: 'chapter' | 'words';
  chunks: NovelChunk[];
  totalChapters: number;
  /** auto 模式下回退到字数切片时为 true */
  fallback: boolean;
}

export function chunkNovel(text: string, opts: Partial<Pick<ExtractConfig, 'chunkStrategy' | 'chaptersPerChunk' | 'wordsPerChunk'>> = {}): ChunkResult {
  const strategy = opts.chunkStrategy ?? 'auto';
  const perChunk = opts.chaptersPerChunk ?? 5;
  const wordsPer = opts.wordsPerChunk ?? 10000;
  if (!text.trim()) return { strategy: 'words', chunks: [], totalChapters: 0, fallback: false };

  if (strategy === 'auto' || strategy === 'chapter') {
    const chapters = splitByChapters(text);
    if (chapters.length >= 3 || strategy === 'chapter') {
      const chunks: NovelChunk[] = [];
      for (let i = 0; i < chapters.length; i += perChunk) {
        const slice = chapters.slice(i, i + perChunk);
        chunks.push({ text: slice.join('\n\n'), strategy: 'chapter', range: `${slice[0]!.title} ~ ${slice[slice.length - 1]!.title}` });
      }
      return { strategy: 'chapter', chunks, totalChapters: chapters.length, fallback: false };
    }
  }

  // 字数 fallback：在句号处断尾
  const chunks: NovelChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + wordsPer, text.length);
    if (end < text.length) {
      const window = text.slice(Math.max(start, end - 200), end);
      const m = /[\s\S]*[。！？\n]/.exec(window);
      if (m && m[0].length > 0) end = Math.max(start, end - 200) + m[0].length;
    }
    chunks.push({ text: text.slice(start, end), strategy: 'words', range: '' });
    start = end;
  }
  return { strategy: 'words', chunks, totalChapters: 0, fallback: strategy === 'auto' };
}

interface ChapterPart {
  title: string;
  text: string;
}

function splitByChapters(text: string): ChapterPart[] {
  const lines = text.split(/\r?\n/);
  const heads: { line: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (CHUNK_HEAD_RE.test(lines[i]!)) heads.push({ line: i, title: lines[i]!.trim().slice(0, 40) });
  }
  if (heads.length < 2) return [];
  const parts: ChapterPart[] = [];
  if (heads[0]!.line > 0 && lines.slice(0, heads[0]!.line).join('').trim().length > 50) {
    parts.push({ title: '开篇', text: lines.slice(0, heads[0]!.line).join('\n') });
  }
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.line : lines.length;
    const body = lines.slice(h.line, end).join('\n');
    if (body.trim().length > 50) parts.push({ title: h.title, text: body });
  });
  return parts;
}

/* ------------------------------------------------------------------ */
/* 结果归一化（空对象过滤 / 枚举收敛 / 字段兜底）                        */
/* ------------------------------------------------------------------ */

/** 整批空对象视为截断/偷懒，返回空数组（调用方据此终止或重试） */
export function normalizeExtractionArray<T>(arr: unknown, type: ExtractType): T[] {
  if (!Array.isArray(arr)) return [];
  const valid = arr.filter((item) => isValidItem(item, type));
  return valid.map((item) => normalizeItem(item, type)) as T[];
}

function isValidItem(item: unknown, type: ExtractType): boolean {
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  switch (type) {
    case 'character':
      return typeof o.name === 'string' && !!o.name;
    case 'eventline':
      return typeof o.name === 'string' && !!o.name;
    case 'timeline':
      return typeof o.stage_name === 'string' && !!o.stage_name;
    case 'setting':
      return typeof o.name === 'string' && !!o.name && typeof o.subtype === 'string' && !!o.subtype;
    case 'item_trajectory':
      return typeof o.item_name === 'string' && !!o.item_name;
  }
}

function normalizeItem(item: unknown, type: ExtractType): unknown {
  const o = item as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (type) {
    case 'character': {
      const t = (o.tracks ?? {}) as Record<string, unknown>;
      return {
        name: o.name,
        role: o.role === 'major' ? 'major' : 'minor',
        first_chapter: str(o.first_chapter) || '未明确章节',
        last_chapter: str(o.last_chapter) || '未明确章节',
        basic: (o.basic && typeof o.basic === 'object' ? o.basic : {}) as Record<string, string>,
        appearance: str(o.appearance),
        tracks: {
          境界: arr(t.境界),
          位置: arr(t.位置),
          物品: arr(t.物品),
          关系: arr(t.关系),
          行为模式: arr(t.行为模式),
        },
      };
    }
    case 'eventline':
      return {
        name: o.name,
        type: (['主线', '支线', '暗线', '伏笔'] as string[]).includes(o.type as string) ? o.type : '支线',
        cause: (o.cause && typeof o.cause === 'object' ? o.cause : null) as ExtractedEventline['cause'],
        passages: arr(o.passages),
        result: (o.result && typeof o.result === 'object' ? o.result : null) as ExtractedEventline['result'],
        follow_up: str(o.follow_up),
      };
    case 'timeline':
      return {
        stage_name: o.stage_name,
        chapter_range: str(o.chapter_range),
        time_markers: arr(o.time_markers),
        summary: str(o.summary),
        protagonist_status: str(o.protagonist_status),
      };
    case 'setting': {
      const subtypes = ['功法', '丹药', '地理', '势力', '世界观常识'];
      return {
        ...o,
        subtype: subtypes.includes(o.subtype as string) ? o.subtype : '世界观常识',
        first_chapter: str(o.first_chapter) || '未明确章节',
      };
    }
    case 'item_trajectory':
      return {
        item_name: o.item_name,
        owner: str(o.owner),
        events: arr(o.events).map((e) => {
          const ev = (e ?? {}) as Record<string, unknown>;
          return {
            chapter: str(ev.chapter) || '未明确章节',
            action: (['获得', '消耗', '转赠'] as string[]).includes(ev.action as string) ? ev.action : '获得',
            source: str(ev.source),
            destination: str(ev.destination),
            evidence: str(ev.evidence),
          };
        }),
      };
  }
}

/* ------------------------------------------------------------------ */
/* 提取结果 → 世界书条目（蓝绿灯自动分配 + 朔递归规则 + YAML 序列化）    */
/* 蓝灯：constant + before_char + 只开 exclude_recursion；              */
/* 绿灯：keys 触发 + after_char + prevent/exclude 双开。                */
/* ------------------------------------------------------------------ */

export interface ExtractedEntry {
  comment: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  constant: boolean;
  selective: boolean;
  enabled: boolean;
  position: 'before_char' | 'after_char';
  insertion_order: number;
  extensions: Record<string, unknown>;
}

export function extractionToWorldEntries(extraction: NovelExtraction, config: ExtractConfig): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];
  const prefix = config.chapterName ? `[${config.chapterName}] ` : '';
  const majors = extraction.characters.filter((c) => c.role === 'major');
  const isMultiMajor = majors.length > 1;

  // 重要角色：单主角卡 → 蓝灯 before_char；多主角卡 → 配角绿灯 after_char
  for (const c of majors) {
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}角色·${c.name}`,
        keys: [c.name],
        content: characterToYaml(c),
        constant: !isMultiMajor,
        position: isMultiMajor ? 'after_char' : 'before_char',
      }),
    );
  }
  // 次要角色 → 绿灯 after_char
  for (const c of extraction.characters.filter((x) => x.role === 'minor')) {
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}次要角色·${c.name}`,
        keys: [c.name],
        content: characterToYaml(c),
        constant: false,
        position: 'after_char',
      }),
    );
  }
  // 事件线：主线蓝灯 before_char；其余绿灯 keys=线名+经过节点关键角色前 3
  for (const ev of extraction.eventlines) {
    const isMain = ev.type === '主线';
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}事件线·${ev.type}·${ev.name}`,
        keys: eventlineKeys(ev),
        content: eventlineToYaml(ev),
        constant: isMain,
        position: isMain ? 'before_char' : 'after_char',
      }),
    );
  }
  // 时间线 → 恒蓝灯
  for (const st of extraction.timeline) {
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}时间线·${st.stage_name}`,
        keys: [],
        content: timelineToYaml(st),
        constant: true,
        position: 'before_char',
      }),
    );
  }
  // 设定 / 物品 → 绿灯 keys=[名称]
  for (const s of extraction.settings) {
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}设定·${s.subtype}·${s.name}`,
        keys: [s.name],
        content: settingToYaml(s),
        constant: false,
        position: 'after_char',
      }),
    );
  }
  for (const it of extraction.item_trajectories) {
    entries.push(
      buildExtractedEntry({
        comment: `${prefix}物品·${it.item_name}`,
        keys: [it.item_name],
        content: itemToYaml(it),
        constant: false,
        position: 'after_char',
      }),
    );
  }
  return entries;
}

function buildExtractedEntry(o: { comment: string; keys: string[]; content: string; constant: boolean; position: 'before_char' | 'after_char' }): ExtractedEntry {
  return {
    comment: o.comment,
    keys: o.keys.filter(Boolean),
    secondary_keys: [],
    content: o.content,
    constant: o.constant,
    selective: !o.constant,
    enabled: true,
    position: o.position,
    insertion_order: 100,
    extensions: {
      position: o.position === 'before_char' ? 0 : 1,
      depth: 4,
      // 朔规则：蓝灯只开 exclude_recursion；绿灯 prevent + exclude 双开
      exclude_recursion: true,
      prevent_recursion: !o.constant,
      probability: 100,
      useProbability: true,
      selectiveLogic: 0,
    },
  };
}

function eventlineKeys(ev: ExtractedEventline): string[] {
  const keys = [ev.name];
  for (const p of ev.passages) {
    for (const k of (p.key_characters ?? []).slice(0, 3)) keys.push(k);
  }
  return [...new Set(keys.filter(Boolean))];
}

/* ---------------- YAML 序列化（content 全中文引号） ---------------- */

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '”');
  return /[:#\n]/.test(s) ? `「${s}」` : s;
}

function chapter(ch: string | undefined): string {
  return ch || '未明确章节';
}

function characterToYaml(c: ExtractedCharacter): string {
  const lines: string[] = [`角色: ${c.name || '(未命名)'}`];
  if (c.role) lines.push(`类型: ${c.role === 'major' ? '重要角色' : '次要角色'}`);
  if (c.first_chapter) lines.push(`首次出场: ${chapter(c.first_chapter)}`);
  if (c.last_chapter) lines.push(`最后出场: ${chapter(c.last_chapter)}`);
  if (c.basic && typeof c.basic === 'object') {
    const basics = Object.entries(c.basic).filter(([, v]) => v);
    if (basics.length) {
      lines.push('基础信息:');
      for (const [k, v] of basics) lines.push(`  ${k}: ${esc(v)}`);
    }
  }
  if (c.appearance) lines.push(`外貌特征: ${esc(c.appearance)}`);
  const t = c.tracks ?? ({} as ExtractedCharacter['tracks']);
  if (t.境界?.length) {
    lines.push('境界轨迹:');
    for (const x of t.境界) lines.push(`  - [${chapter(x.chapter)}] ${esc(x.state)}${x.evidence ? `（${esc(x.evidence)}）` : ''}`);
  }
  if (t.位置?.length) {
    lines.push('位置轨迹:');
    for (const x of t.位置) lines.push(`  - [${chapter(x.chapter)}] ${esc(x.location)}`);
  }
  if (t.物品?.length) {
    lines.push('物品轨迹:');
    for (const x of t.物品)
      lines.push(`  - [${chapter(x.chapter)}] ${esc(x.action)} ${esc(x.item)}${x.source ? `（来源: ${esc(x.source)}）` : ''}${x.destination ? `（去向: ${esc(x.destination)}）` : ''}`);
  }
  if (t.关系?.length) {
    lines.push('关系:');
    for (const r of t.关系) {
      lines.push(`  与 ${esc(r.target || '(未指定)')}:`);
      for (const b of r.behaviors ?? []) lines.push(`    - [${chapter(b.chapter)}] ${esc(b.behavior)}${b.context ? ` ${esc(b.context)}` : ''}`);
      if (r.summary) lines.push(`    互动特征: ${esc(r.summary)}`);
      if (r.boundary) lines.push(`    原著边界: ${esc(r.boundary)}`);
    }
  }
  if (t.行为模式?.length) {
    lines.push('行为模式:');
    for (const st of t.行为模式) {
      lines.push(`  ${esc(st.stage || '阶段')}（${esc(st.range || '未明确')}）:`);
      if (st.dialogues?.length) {
        lines.push('    台词:');
        for (const d of st.dialogues) lines.push(`      - ${esc(d)}`);
      }
      if (st.decisions) lines.push(`    决策倾向: ${esc(st.decisions)}`);
    }
  }
  return lines.join('\n');
}

function eventlineToYaml(ev: ExtractedEventline): string {
  const lines: string[] = [`事件线: ${ev.name || '(未命名)'}`, `类型: ${ev.type || '支线'}`];
  if (ev.cause) {
    lines.push('起因:', `  章节: ${chapter(ev.cause.chapter)}`);
    if (ev.cause.summary) lines.push(`  概括: ${esc(ev.cause.summary)}`);
    if (ev.cause.dialogue) lines.push(`  代表性台词: ${esc(ev.cause.dialogue)}`);
  }
  if (ev.passages?.length) {
    lines.push('经过:');
    ev.passages.forEach((p, i) => {
      lines.push(`  ${i + 1}. [${chapter(p.chapter)}] ${esc(p.node)}`);
      if (p.location) lines.push(`     地点: ${esc(p.location)}`);
      if (p.key_characters?.length) lines.push(`     关键人物: ${p.key_characters.map(esc).join('、')}`);
      if (p.dialogue) lines.push(`     代表性台词: ${esc(p.dialogue)}`);
    });
  }
  if (ev.result) {
    lines.push('结果:', `  章节: ${chapter(ev.result.chapter)}`);
    if (ev.result.summary) lines.push(`  概括: ${esc(ev.result.summary)}`);
    if (ev.result.dialogue) lines.push(`  代表性台词: ${esc(ev.result.dialogue)}`);
  }
  if (ev.follow_up) lines.push(`后续影响: ${esc(ev.follow_up)}`);
  return lines.join('\n');
}

function timelineToYaml(st: ExtractedTimelineStage): string {
  const lines: string[] = [`时间线阶段: ${st.stage_name || '(未命名)'}`];
  if (st.chapter_range) lines.push(`章节范围: ${st.chapter_range}`);
  if (st.time_markers?.length) {
    lines.push('时间标记:');
    for (const t of st.time_markers) lines.push(`  - [${chapter(t.chapter)}] ${esc(t.raw)}${t.annotation ? `（${esc(t.annotation)}）` : ''}`);
  }
  if (st.summary) lines.push(`概括: ${esc(st.summary)}`);
  if (st.protagonist_status) lines.push(`主角状态: ${esc(st.protagonist_status)}`);
  return lines.join('\n');
}

function settingToYaml(s: ExtractedSetting): string {
  const lines: string[] = [`${s.subtype || '设定'}: ${s.name || '(未命名)'}`];
  if (s.level) lines.push(`等级: ${esc(s.level)}`);
  if (s.grade) lines.push(`品级: ${esc(s.grade)}`);
  if (s.user) lines.push(`使用者: ${esc(s.user)}`);
  if (s.refiner) lines.push(`炼制者: ${esc(s.refiner)}`);
  if (s.first_chapter) lines.push(`首次出现: ${chapter(s.first_chapter)}`);
  if (s.effect) lines.push(`效果: ${esc(s.effect)}`);
  if (s.description) lines.push(`描述: ${esc(s.description)}`);
  return lines.join('\n');
}

function itemToYaml(it: ExtractedItem): string {
  const lines: string[] = [`物品: ${it.item_name || '(未命名)'}`];
  if (it.owner) lines.push(`持有者: ${esc(it.owner)}`);
  if (it.events?.length) {
    lines.push('流转记录:');
    for (const e of it.events) {
      const detail = e.source ? `来源: ${esc(e.source)}` : e.destination ? `去向: ${esc(e.destination)}` : '';
      lines.push(`  - [${chapter(e.chapter)}] ${e.action}${detail ? `（${detail}）` : ''}${e.evidence ? ` / 证据: ${esc(e.evidence)}` : ''}`);
    }
  }
  return lines.join('\n');
}
