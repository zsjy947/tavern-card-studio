/**
 * chara_card_v2 / v3 完整类型定义（zod schema）。
 *
 * 兼容性基准：
 * - 规范字段 https://github.com/malfoyslastname/character_card_v2 与 V3 扩展
 * - SillyTavern 实际读写行为（src/character-card-parser.js：ccv3 优先、chara 回退）
 * - 真实社区卡样例（extensions 内嵌 regex_scripts / depth_prompt / talkativeness 等）
 *
 * 设计原则：**宽容读取，规范写出**。
 * 解析时未知字段一律保留（passthrough），避免破坏社区卡生态里的私有扩展。
 */
import { z } from 'zod';

export const SPEC_V2 = 'chara_card_v2';
export const SPEC_V3 = 'chara_card_v3';

/* ------------------------------------------------------------------ */
/* 世界书（内嵌 character_book，规范格式）                             */
/* ------------------------------------------------------------------ */

export const bookPositionEnum = z.enum(['before_char', 'after_char']);

/** 真实社区卡常见 0/1 数字布尔（如 delay_until_recursion: 0，ST 部分版本导出形态），宽容为 boolean */
const boolish = z.preprocess((v) => (typeof v === 'number' ? v !== 0 : v), z.boolean().optional());
const boolishNullable = z.preprocess((v) => (typeof v === 'number' ? v !== 0 : v), z.boolean().nullable().optional());

export const bookEntryExtensionSchema = z
  .object({
    // SillyTavern 全局世界书专属字段，双向互转时存放于此（见 core/lorebook）
    position: z.number().int().optional(),
    exclude_recursion: boolish,
    prevent_recursion: boolish,
    delay_until_recursion: boolish,
    display_index: z.number().int().optional(),
    probability: z.number().optional(),
    useProbability: boolish,
    depth: z.number().int().optional(),
    selectiveLogic: z.number().int().optional(),
    group: z.string().optional(),
    groupOverride: boolish,
    groupWeight: z.number().optional(),
    scan_depth: z.number().int().nullable().optional(),
    case_sensitive: boolishNullable,
    match_whole_words: boolishNullable,
    use_group_scoring: boolishNullable,
    automation_id: z.string().optional(),
    role: z.number().int().optional(),
    vectorized: boolish,
    sticky: z.number().nullable().optional(),
    cooldown: z.number().nullable().optional(),
    delay: z.number().nullable().optional(),
    triggers: z.array(z.string()).optional(),
    outlet_name: z.string().optional(),
  })
  .partial()
  .passthrough();

export const bookEntrySchema = z
  .object({
    // 真实社区卡条目可能缺 id：在 characterBookSchema.entries 的 preprocess 里按序号兜底
    id: z.number().int(),
    keys: z.array(z.string()).default([]),
    secondary_keys: z.array(z.string()).default([]),
    // 真实社区卡偶见 comment 为数组（标签式标题）或数字：统一收敛为字符串
    comment: z.preprocess((v) => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.map(String).join('、');
      return typeof v === 'string' ? v : String(v);
    }, z.string().default('')),
    content: z.string().default(''),
    constant: z.boolean().default(false),
    selective: z.boolean().default(false),
    insertion_order: z.number().int().default(100),
    enabled: z.boolean().default(true),
    position: bookPositionEnum.default('before_char'),
    use_regex: z.boolean().default(false),
    extensions: bookEntryExtensionSchema.default({}),
  })
  .passthrough();

export const characterBookSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  scan_depth: z.number().int().optional(),
  token_budget: z.number().int().optional(),
  recursive_scanning: z.boolean().optional(),
  extensions: z.record(z.unknown()).default({}),
  entries: z.preprocess(fillMissingIds((i) => i), z.array(bookEntrySchema).default([])),
});

/* ------------------------------------------------------------------ */
/* 正则脚本（SillyTavern extensions.regex_scripts）                     */
/* ------------------------------------------------------------------ */

export const regexScriptSchema = z
  .object({
    // 真实社区卡的正则脚本普遍没有 id（ST 保存时才生成）：缺失时按序号兜底（见下方 preprocess）
    id: z.string(),
    scriptName: z.string(),
    findRegex: z.string(),
    replaceString: z.string().default(''),
    trimStrings: z.array(z.string()).default([]),
    placement: z.array(z.number().int()).default([]),
    disabled: z.boolean().default(false),
    markdownOnly: z.boolean().default(false),
    promptOnly: z.boolean().default(false),
    runOnEdit: z.boolean().default(true),
    substituteRegex: z.number().int().default(0),
    minDepth: z.number().int().nullable().default(null),
    maxDepth: z.number().int().nullable().default(null),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/* 酒馆助手脚本 / 快速回复                                              */
/* ------------------------------------------------------------------ */

export const tavernHelperScriptSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    comment: z.string().default(''),
    type: z.string().default('inline'),
    enabled: z.boolean().default(true),
    autoRun: z.boolean().default(false),
    // 脚本触发时机（TavernHelper 约定字符串）
    event: z.string().default(''),
    content: z.string().default(''),
  })
  .passthrough();

export const quickReplySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    message: z.string().default(''),
    /** TavernHelper QuickReply v2: setLabel? 简化为字符串命令 */
    command: z.string().default(''),
    fileName: z.string().default(''),
    hidden: z.boolean().default(false),
    executeOnStartup: z.boolean().default(false),
    executeOnUser: z.boolean().default(false),
    executeOnAi: z.boolean().default(false),
  })
  .passthrough();

/**
 * 数组元素缺 id 时的确定性兜底（按序号补）：同一张卡两次导入得到相同 id，
 * 保证 dataHash 稳定（导入去重依赖哈希一致）。makeId 收到序号，返回可用的 id。
 */
function fillMissingIds(makeId: (i: number) => unknown) {
  return (raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    return raw.map((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      if ((item as { id?: unknown }).id !== undefined) return item;
      return { ...item, id: makeId(i) };
    });
  };
}

/* ------------------------------------------------------------------ */
/* depth prompt 等                                                      */
/* ------------------------------------------------------------------ */

export const depthPromptSchema = z.object({
  prompt: z.string().default(''),
  depth: z.number().int().default(4),
  role: z.enum(['system', 'user', 'assistant']).default('system'),
});

/* ------------------------------------------------------------------ */
/* V2/V3 共享 data 块                                                   */
/* ------------------------------------------------------------------ */

const tagList = z.union([z.array(z.string()), z.string()]).transform((v) =>
  typeof v === 'string'
    ? v.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : v,
);

export const cardDataBaseSchema = z.object({
  // 允许空名：解析层宽容，导入服务负责兜底命名，诊断层负责报错
  name: z.string(),
  description: z.string().default(''),
  personality: z.string().default(''),
  scenario: z.string().default(''),
  first_mes: z.string().default(''),
  mes_example: z.string().default(''),
  creator_notes: z.string().default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  alternate_greetings: z.array(z.string()).default([]),
  tags: tagList.default([]),
  creator: z.string().default(''),
  character_version: z.string().default(''),
  extensions: z
    .object({
      talkativeness: z.union([z.string(), z.number()]).optional(),
      fav: z.boolean().optional(),
      world: z.string().optional(),
      depth_prompt: depthPromptSchema.optional(),
      regex_scripts: z.preprocess(fillMissingIds((i) => `script_${i}`), z.array(regexScriptSchema).optional()),
      TavernHelper_scripts: z.preprocess(fillMissingIds((i) => `ths_${i}`), z.array(tavernHelperScriptSchema).optional()),
      // 真实社区卡 tavern_helper 存在数组形态（不同 TavernHelper 版本）： union 透传保留原数据
      tavern_helper: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
      QuickReply: z.preprocess(fillMissingIds((i) => `qr_${i}`), z.array(quickReplySchema).optional()),
    })
    .partial()
    .passthrough()
    .default({}),
  character_book: characterBookSchema.optional(),
});

/** V3 在 data 内新增的字段 */
export const cardDataV3Schema = cardDataBaseSchema.extend({
  nickname: z.string().default(''),
  personal_notes: z.string().default(''),
  creator_notes_multilingual: z.record(z.string()).default({}),
  system_prompt_multilingual: z.record(z.string()).default({}),
  personality_multilingual: z.record(z.string()).default({}),
  scenario_multilingual: z.record(z.string()).default({}),
  first_mes_multilingual: z.record(z.string()).default({}),
  mes_example_multilingual: z.record(z.string()).default({}),
  tags_multilingual: z.record(z.array(z.string())).default({}),
});

/* ------------------------------------------------------------------ */
/* 完整卡（顶层包装）                                                   */
/* ------------------------------------------------------------------ */

/** 导入时的宽容解析：兼容顶层 V1 字段、data 块、spec 缺失等社区卡乱象 */
export const looseCardSchema = z
  .object({
    spec: z.string().optional(),
    spec_version: z.string().optional(),
    data: z.unknown().optional(),
    // V1 顶层字段回退
    name: z.string().optional(),
    description: z.string().optional(),
    personality: z.string().optional(),
    scenario: z.string().optional(),
    first_mes: z.string().optional(),
    mes_example: z.string().optional(),
    creatorcomment: z.string().optional(),
    avatar: z.unknown().optional(),
    talkativeness: z.union([z.string(), z.number()]).optional(),
    fav: z.boolean().optional(),
    tags: z.union([z.array(z.string()), z.string()]).optional(),
    create_date: z.string().optional(),
  })
  .passthrough()
  .catchall(z.unknown());

export type BookEntry = z.infer<typeof bookEntrySchema>;
export type CharacterBook = z.infer<typeof characterBookSchema>;
export type RegexScript = z.infer<typeof regexScriptSchema>;
export type TavernHelperScript = z.infer<typeof tavernHelperScriptSchema>;
export type QuickReply = z.infer<typeof quickReplySchema>;
export type DepthPrompt = z.infer<typeof depthPromptSchema>;
export type CardData = z.infer<typeof cardDataBaseSchema>;
export type CardDataV3 = z.infer<typeof cardDataV3Schema>;

export interface CharacterCardV2 {
  spec: typeof SPEC_V2;
  spec_version: '2.0';
  data: CardData;
  /** 顶层冗余字段（部分前端读取，导出时由 normalize 补齐） */
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  tags?: string[];
  creatorcomment?: string;
  avatar?: string;
  talkativeness?: string | number;
  fav?: boolean;
  create_date?: string;
}

export interface CharacterCardV3 extends Omit<CharacterCardV2, 'spec' | 'spec_version' | 'data'> {
  spec: typeof SPEC_V3;
  spec_version: '3.0';
  data: CardDataV3;
}

export type AnyCard = CharacterCardV2 | CharacterCardV3;
