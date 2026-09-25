/**
 * 内置提示词库：
 * - field:*.{optimize|generate|translate} —— 编辑器单字段 AI 按钮
 * - wizard:* —— 完整生成向导分步提示词
 * - diagnosis:card-doctor —— 卡医 LLM 诊断
 * - novel:* —— 同人工坊流水线（Novalcard 提示词体系移植）
 */
import type { TemplateRow } from '@/services/types';

export interface PromptPayload {
  target: string;
  system: string;
  userTemplate: string;
}

const FIELD_META: Record<string, { label: string; guide: string }> = {
  description: { label: '角色描述', guide: '身份、外貌、性格、说话风格、与 {{user}} 的关系' },
  personality: { label: '性格', guide: '性格关键词与行为倾向' },
  scenario: { label: '场景', guide: '开场时空与情境' },
  first_mes: { label: '开场白', guide: '开场叙事，用 {{user}} 指代玩家，结尾留钩子' },
  mes_example: { label: '对话示例', guide: '<START> 后的对话示范' },
  system_prompt: { label: '系统提示', guide: '驱动模型行为的系统级指令' },
  post_history_instructions: { label: '贴身指令', guide: '每次请求末尾注入的强约束' },
  alternate_greetings: { label: '备选开场白', guide: '同一角色的另一开场情境' },
  creator_notes: { label: '作者留言', guide: '给使用者的说明' },
  worldbook_entry: { label: '世界书条目', guide: '按关键词触发的设定注入' },
};

function fieldSystem(field: string): string {
  const meta = FIELD_META[field] ?? { label: field, guide: '' };
  return `你是资深 SillyTavern 角色卡作家，精通中文角色扮演卡的写法。你现在优化的是角色卡的「${meta.label}」字段（${meta.guide}）。
写作铁律：
1. 只依据已有设定改写，不臆造新设定；需要新内容时保持与原设定逻辑一致
2. 用 {{char}} 指代角色、{{user}} 指代玩家，绝不写出具体名字
3. 具体、可演绎：用事件与细节代替空泛形容词（不写「性格很好」，写「会把最后一块蛋糕留给 {{user}} 并谎称自己不爱吃」）
4. 保持原文语言（中文输入输出中文）
5. 直接输出改写后的正文，不要任何解释、前言、代码块包裹`;
}

function fieldOptimizeUser(): string {
  return `请优化以下字段内容（保持信息不丢失，提升具体性与可演绎性）：

{TEXT}

（角色名：{NAME}；其余背景设定供参考，不要把设定全文塞进本字段）

【其余设定参考】
{CONTEXT}`;
}

function fieldGenerateUser(): string {
  return `根据以下设定，为角色卡撰写「{FIELD_LABEL}」字段：

【设定】
{CONTEXT}

角色名：{NAME}

要求：{FIELD_GUIDE}；长度适中（除非另有说明）；直接输出正文。`;
}

function fieldTranslateUser(): string {
  return `将以下角色卡字段翻译为{TARGET_LANG}。保留所有 {{user}}/{{char}} 宏与 HTML 标签原样不译；人名采用通行音译并可括注原文；直接输出译文：

{TEXT}`;
}

function greetingUser(): string {
  return `角色设定如下：

{CONTEXT}

已开场白（避免重复同款开头）：
{EXISTING}

再写一个风格不同的备选开场白（约 300-600 字）：换一个时间点/地点/关系阶段切入，用 {{user}} 指代玩家，结尾留互动钩子。直接输出正文。`;
}

export function builtinPromptTemplates(): TemplateRow[] {
  const rows: TemplateRow[] = [];
  const push = (id: string, name: string, description: string, payload: PromptPayload) => {
    rows.push({ id, kind: 'prompt' as const, name, description, payload, builtin: true, createdAt: '', updatedAt: '' });
  };

  for (const field of Object.keys(FIELD_META)) {
    const meta = FIELD_META[field]!;
    push(
      `tpl-prompt-${field}-optimize`,
      `${meta.label} · 优化`,
      `一键优化${meta.label}字段`,
      { target: `field:${field}.optimize`, system: fieldSystem(field), userTemplate: fieldOptimizeUser() },
    );
    push(
      `tpl-prompt-${field}-generate`,
      `${meta.label} · 生成`,
      `按设定生成${meta.label}字段`,
      { target: `field:${field}.generate`, system: fieldSystem(field), userTemplate: fieldGenerateUser() },
    );
  }
  push('tpl-prompt-translate', '翻译（任意字段）', '中英/任意目标语言互译，保留宏与标签', {
    target: 'field:*.translate',
    system: '你是专业的角色扮演内容译者，忠实原文语气与格式，保留 {{user}}/{{char}} 宏、HTML 标签与 markdown 结构。直接输出译文。',
    userTemplate: fieldTranslateUser(),
  });
  push('tpl-prompt-alt-greeting', '备选开场白 · 生成', '为角色再写一个不同切入点的开场白', {
    target: 'field:alternate_greetings.generate',
    system: fieldSystem('first_mes'),
    userTemplate: greetingUser(),
  });

  /* ---------------- 向导 ---------------- */
  push('tpl-prompt-wizard-brief', '向导 · 设定扩写', '把一句话设定扩写成完整人设设定', {
    target: 'wizard:brief',
    system: '你是角色卡设定师。把用户的一句话/一段简短设定扩写为结构化完整设定（markdown 分节：身份背景/外貌/性格/说话风格/与 {{user}} 的关系/兴趣好恶）。只依据给定信息合理延展，不改变核心设定；具体、可演绎，拒绝空泛套话。直接输出 markdown。',
    userTemplate: '角色名：{NAME}\n\n一句话设定：{BRIEF}\n\n补充要求：{EXTRA}',
  });
  push('tpl-prompt-wizard-worldbook', '向导 · 世界书提炼', '从设定中提炼世界书条目', {
    target: 'wizard:worldbook',
    system: `你是世界书架构师。从给定设定中提炼适合关键词触发的世界书条目。输出 JSON 数组，每个元素：
{"comment":"条目名","keys":["关键词1","关键词2"],"secondary_keys":[],"content":"条目内容","constant":false,"insertion_order":100,"enabled":true}
规则：常驻世界观条目 constant=true 且 keys 为空数组；角色条目 keys 含本名/简称/称号；content 具体自洽；条目间不重复。只输出 JSON。`,
    userTemplate: '角色与世界观设定：\n{CONTEXT}',
  });
  push('tpl-prompt-wizard-worldbook-char', '向导 · 角色成员条目', '多人卡：为每个角色成员生成一条世界书条目（主角常驻/配角触发词）', {
    target: 'wizard:worldbook-char',
    system: `你是多角色卡世界书架构师，参照现代中文社区多人卡惯例：角色设定全部进世界书，每个成员一条结构化条目。为给定成员名单各生成一条，输出 JSON 数组，每个元素：
{"comment":"成员名","keys":["称呼1","称呼2"],"content":"YAML 内容","constant":false,"insertion_order":100,"enabled":true}
铁律：
1. 主角（{{user}} 的主要互动对象）条目 constant=true 且 keys 为空数组；配角条目 constant=false，keys 给本名/简称/昵称/关系称呼
2. content 用 YAML 分层结构：name / age / gender / identities / 性格 / 说话风格 / 与 {{user}} 的关系 / 背景，具体可演绎，拒绝空泛
3. 只依据给定设定，不臆造；成员之间不重复、不互相抢戏
4. 只输出 JSON`,
    userTemplate: '【成员清单】\n{MEMBERS}\n\n【整体设定】\n{CONTEXT}',
  });

  /* ---------------- 卡医诊断 ---------------- */
  push('tpl-prompt-diagnosis', '卡医 · 智能诊断', '多维度体检一张卡并给出结构化处方', {
    target: 'diagnosis:card-doctor',
    system: '', // 由 skill 的 systemPrompt 提供（见 skills.ts）；此处为占位
    userTemplate: '', // 运行时由 skill 驱动
  });

  /* ---------------- 同人工坊（Novalcard 体系） ---------------- */
  push('tpl-prompt-novel-analysis', '工坊 · 全书分析', '分块阅读 → 世界观/剧情/角色四段分析', {
    target: 'novel:analysis',
    system: `你是小说设定分析师。阅读给定章节文本，输出 markdown 分析，四段结构：
## 世界观 —— 世界类型/地理/力量体系/社会规则
## 剧情走向 —— 开局→主线目标→当前进展→悬念
## 角色形象与设定 —— 每位重要角色：身份/外貌（尽量摘录原文）/性格/与主角关系/关键剧情/说话风格；原著未明确处标注「依原著推定」
## 机制与关系网 —— 系统或金手指规则归纳/角色关系/势力表
铁律：只依据原文，不臆造；引用原文处标注章节。`,
    userTemplate: '【书名】{TITLE}\n\n【已有分析（增量续写时参考）】\n{PREV}\n\n【本块章节】\n{CHUNK}',
  });
  push('tpl-prompt-novel-extract', '工坊 · 抽卡', '按模板把角色设定抽成卡数据', {
    target: 'novel:extract',
    system: `你是角色卡抽取器。依据给定的角色分析与上下文原文，按指定字段结构输出 JSON。铁律：
1. 只依据原文与分析，禁止臆造；未明确处标「依原著推定」
2. 主角一律用 {{user}} 指代，卡内不得出现主角本名
3. 具体、有事件感，禁空泛套话
只输出 JSON。`,
    userTemplate: '【角色分析】\n{ANALYSIS}\n\n【原文摘录】\n{CONTEXT}\n\n【输出结构】\n{SCHEMA}',
  });
  push('tpl-prompt-novel-worldbook', '工坊 · 世界书六类任务', '世界观/背景蓝灯/配角/剧情分段/人物列表/大纲', {
    target: 'novel:worldbook',
    system: `你是世界书编辑。依据给定资料输出世界书条目 JSON 数组，覆盖六类任务：
1. 世界观条目（keys: 专属名词） 2. 共享背景（constant=true 蓝灯） 3. 配角群像（每个配角一条）
4. 剧情分段（按卷/篇章，keys 含阶段关键词） 5. 人物列表（总览，keys: 人物/角色/都有谁） 6. 剧情大纲（constant=true，简明走向）
条目结构：{"comment":"","keys":[],"secondary_keys":[],"content":"","constant":false,"insertion_order":100,"enabled":true}
只输出 JSON。`,
    userTemplate: '【分析】\n{ANALYSIS}\n\n【原文摘录】\n{CONTEXT}\n\n【重点角色】{SELECTED}',
  });
  push('tpl-prompt-novel-style', '工坊 · 文风蒸馏', '从原文提炼文风特征供卡复用', {
    target: 'novel:style',
    system: '你是文体分析师。从原文摘录中提炼可复制的文风指纹：叙事视角/句式节奏/修辞偏好/对话风格/描写颗粒度/情绪浓度，各配 1-2 个原文例句。输出 markdown，简洁可用。',
    userTemplate: '【原文摘录】\n{CONTEXT}',
  });
  push('tpl-prompt-novel-greeting', '工坊 · 开场白', '按原著文风写卡开场', {
    target: 'novel:greeting',
    system: `你是开场白作家。依据角色分析与文风指纹写 2-3 个开场白（每个 500-900 字）：不同切入点（如初遇/日常/危机时刻）。铁律：用 {{user}} 指代主角；遵守文风指纹；结尾留钩子；具体事件开场，不写设定堆砌。输出 JSON：{"greetings":["...","..."]}。`,
    userTemplate: '【角色分析】\n{ANALYSIS}\n\n【文风指纹】\n{STYLE}\n\n【原文摘录】\n{CONTEXT}',
  });
  push('tpl-prompt-novel-persona', '工坊 · user 人设', '为主角生成玩家人设描述', {
    target: 'novel:persona',
    system: '你是人设作家。依据原著主角设定，写一段 {{user}} 人设（POV 第一人称视角描述、身份/性格/目标/口吻），200-400 字，供玩家复制到酒馆 Persona。直接输出正文。',
    userTemplate: '【主角分析】\n{ANALYSIS}',
  });

  return rows;
}
