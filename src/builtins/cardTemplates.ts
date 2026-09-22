/**
 * 内置卡片模板（结构移植自 Novalcard 五套，供分步生成向导使用）。
 */
import type { TemplateRow } from '@/services/types';

export interface CardTemplateField {
  key: string;
  label: string;
  hint: string;
  placeholder?: string;
  required?: boolean;
}

export interface CardTemplatePayload {
  spec: 'v2' | 'v3';
  summary: string;
  fields: CardTemplateField[];
  defaultTags: string[];
}

const COMMON_TAIL: CardTemplateField[] = [
  { key: 'tags', label: '标签', hint: '逗号分隔，便于卡库检索', placeholder: '原创,中文,现代' },
  { key: 'creator', label: '作者', hint: '你的名字', placeholder: 'Anonymous' },
  { key: 'character_version', label: '版本号', hint: '如 1.0', placeholder: '1.0' },
];

const FULL: CardTemplatePayload = {
  spec: 'v3',
  summary: '全字段模板：完整覆盖人设、关系、行为逻辑与世界书，适合主力卡',
  defaultTags: ['中文', '原创'],
  fields: [
    { key: 'name', label: '角色名', hint: '角色的名字，{{char}} 宏将指向它', placeholder: '林晚', required: true },
    { key: 'description', label: '角色描述', hint: '核心人设：身份、外貌、性格、说话风格、与 {{user}} 的关系。用要点式书写，方便 AI 检索', required: true },
    { key: 'personality', label: '性格', hint: '3-6 个性格关键词与简述' },
    { key: 'scenario', label: '场景', hint: '故事开场的时空与情境' },
    { key: 'first_mes', label: '开场白', hint: '第一人称或第三人称开场叙事，用 {{user}} 指代玩家。好的开场白带一个钩子', required: true },
    { key: 'mes_example', label: '对话示例', hint: '1-3 轮对话示范口吻，格式：<START> 后 {{char}}: … / {{user}}: …' },
    { key: 'system_prompt', label: '系统提示', hint: '覆盖酒馆默认系统提示（高级）' },
    { key: 'post_history_instructions', hint: '贴身指令：每次请求末尾注入的强约束（高级）', label: '贴身指令' },
    ...COMMON_TAIL,
  ],
};

const EVENT: CardTemplatePayload = {
  spec: 'v3',
  summary: '事件导向模板：以场景与事件为主线，人设服务于剧情推进，适合冒险/推理卡',
  defaultTags: ['中文', '事件导向'],
  fields: [
    { key: 'name', label: '事件/角色名', hint: '以事件命名的卡名', placeholder: '深夜便利店', required: true },
    { key: 'scenario', label: '核心事件', hint: '先写事件：发生了什么、有什么悬念、参与者是谁', required: true },
    { key: 'description', label: '关键人物与规则', hint: '事件中的关键 NPC 各一段 + 事件规则（可选：随机事件表）', required: true },
    { key: 'first_mes', label: '开场情景', hint: '把 {{user}} 放进事件现场的瞬间', required: true },
    { key: 'personality', label: 'NPC 性格速写', hint: '每个 NPC 一行' },
    { key: 'mes_example', label: '事件推进示例', hint: '示范一次事件推进的对话' },
    ...COMMON_TAIL,
  ],
};

const MINIMAL: CardTemplatePayload = {
  spec: 'v2',
  summary: '精简人设模板：只要名字、描述、性格、开场白，五分钟出一张能玩的卡',
  defaultTags: ['中文', '精简'],
  fields: [
    { key: 'name', label: '角色名', hint: '角色叫什么', placeholder: '阿茶', required: true },
    { key: 'description', label: '一段话人设', hint: '身份+外貌+性格+与 {{user}} 的关系，一段话写完', required: true },
    { key: 'personality', label: '性格关键词', hint: '逗号分隔即可', placeholder: '温柔,粘人,有点笨拙' },
    { key: 'first_mes', label: '开场白', hint: '角色对 {{user}} 说的第一段话/场景', required: true },
    ...COMMON_TAIL,
  ],
};

const NPC: CardTemplatePayload = {
  spec: 'v2',
  summary: 'NPC 配角模板：轻量配角卡，主字段少而精，适合群像补充',
  defaultTags: ['中文', 'NPC'],
  fields: [
    { key: 'name', label: '配角名', hint: '配角的名字', required: true },
    { key: 'description', label: '配角设定', hint: '身份、性格一两句、口头禅或标志性动作', required: true },
    { key: 'scenario', label: '出场情境', hint: '他/她通常在哪里出现、和主线的关系' },
    { key: 'first_mes', label: '初次登场', hint: '一段登场描写', required: true },
    ...COMMON_TAIL,
  ],
};

const BLANK: CardTemplatePayload = {
  spec: 'v3',
  summary: '空白模板：全部字段自选，适合从模板库之外自由搭建',
  defaultTags: [],
  fields: [
    { key: 'name', label: '角色名', hint: '必填', required: true },
    ...COMMON_TAIL,
  ],
};

export function builtinCardTemplates(): TemplateRow[] {
  const defs: [string, string, CardTemplatePayload][] = [
    ['tpl-card-full', '默认全档', FULL],
    ['tpl-card-event', '事件导向', EVENT],
    ['tpl-card-minimal', '精简人设', MINIMAL],
    ['tpl-card-npc', 'NPC 配角', NPC],
    ['tpl-card-blank', '空白', BLANK],
  ];
  return defs.map(([id, name, payload]) => ({
    id,
    kind: 'card' as const,
    name,
    description: payload.summary,
    payload,
    builtin: true,
    createdAt: '',
    updatedAt: '',
  }));
}
