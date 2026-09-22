/** 数据库行模型（与规划 §3 的表一一对应，整对象存储） */
import type { AnyCard } from '@/core/card';
import type { TokenStats } from '@/core/stats/tokens';

export interface CardRow {
  id: string;
  name: string;
  spec: string;
  tags: string[];
  categoryId: string | null;
  /** 完整卡片对象 */
  card: AnyCard;
  /** 封面：data URL 或外链 */
  cover: string | null;
  tokenStats: TokenStats | null;
  dataHash: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardVersionRow {
  id: string;
  cardId: string;
  versionNo: number;
  note: string;
  card: AnyCard;
  dataHash: string;
  createdAt: string;
}

export type TemplateKind = 'card' | 'statusbar' | 'regex' | 'prompt';

export interface TemplateRow {
  id: string;
  kind: TemplateKind;
  name: string;
  description?: string;
  /** kind 对应的负载结构见 builtins/* */
  payload: unknown;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRow {
  id: string;
  name: string;
  systemPrompt: string;
  /** 每步的指令 */
  steps: string[];
  /** 期望输出 JSON 的 schema 描述（给 LLM 的文字版） */
  outputSchema: string;
  builtin: boolean;
}

export interface AiChannelRow {
  id: string;
  name: string;
  kind: 'text' | 'image';
  provider: 'openai' | 'novelai' | 'custom';
  baseUrl: string;
  apiKey: string;
  modelId: string;
  isActive: boolean;
}

export interface AiUsageLogRow {
  id: string;
  channelId: string;
  channelName: string;
  feature: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  createdAt: string;
}

export type PipelineStage =
  | 'chapters' | 'scan' | 'select' | 'context' | 'extract'
  | 'worldbook' | 'style' | 'greeting' | 'persona' | 'done';

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  chapters: '章节切分',
  scan: '角色扫描',
  select: '选定角色',
  context: '上下文检索',
  extract: '抽取成卡',
  worldbook: '世界书任务',
  style: '文风蒸馏',
  greeting: '开场白',
  persona: 'user 人设',
  done: '完成',
};

export interface NovelProjectRow {
  id: string;
  title: string;
  sourceName: string;
  /** 章节文本（切分后保存，断点续跑的底料） */
  chapters: { index: number; title: string; content: string }[];
  pipelineState: {
    stage: PipelineStage;
    candidates: { name: string; count: number }[];
    selected: string[];
    aliases: Record<string, string[]>;
    analysis: string;
    context: string;
    templateId: string | null;
    cardTemplateFilled: Record<string, unknown> | null;
    extractedCard: AnyCard | null;
    userPersona: string;
    greetings: string[];
    logs: { at: string; stage: PipelineStage; message: string }[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  sort: number;
}

export interface SettingRow {
  id: string;
  value: unknown;
}
