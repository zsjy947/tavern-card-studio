/**
 * AI 服务：渠道管理、统一调用入口（自动记用量）、按字段生成/优化/翻译、诊断 skill 执行。
 */
import { getStore, genId } from '@/db';
import { LlmClient, extractJson, type ChannelConfig, type ChatMessage } from '@/core/llm';
import type { AiChannelRow, AiUsageLogRow } from './types';

/* ---------------- 渠道 ---------------- */

export async function listChannels(): Promise<AiChannelRow[]> {
  return (await (await getStore()).list<AiChannelRow>('ai_channels')).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export async function saveChannel(ch: Omit<AiChannelRow, 'id'> & { id?: string }): Promise<AiChannelRow> {
  const store = await getStore();
  const row: AiChannelRow = { ...ch, id: ch.id ?? genId('ch') };
  // 同 kind 下激活互斥
  if (row.isActive) {
    for (const other of await store.list<AiChannelRow>('ai_channels')) {
      if (other.kind === row.kind && other.id !== row.id && other.isActive) {
        await store.put('ai_channels', other.id, { ...other, isActive: false });
      }
    }
  }
  await store.put('ai_channels', row.id, row);
  return row;
}

export async function deleteChannel(id: string): Promise<void> {
  await (await getStore()).delete('ai_channels', id);
}

/** 当前激活渠道 → LlmClient */
export async function getActiveClient(kind: 'text' | 'image'): Promise<{ client: LlmClient; channel: AiChannelRow }> {
  const channels = await listChannels();
  const active = channels.find((c) => c.kind === kind && c.isActive) ?? channels.find((c) => c.kind === kind);
  if (!active) throw new Error(`没有可用的${kind === 'text' ? '文本' : '生图'}渠道，请先在 AI 中心配置`);
  const config: ChannelConfig = {
    id: active.id,
    name: active.name,
    kind: active.kind,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    modelId: active.modelId,
    isActive: active.isActive,
  };
  return { client: new LlmClient(config), channel: active };
}

/* ---------------- 用量记录 ---------------- */

export async function logUsage(channel: AiChannelRow, feature: string, r: { promptTokens: number; completionTokens: number; ms: number }): Promise<void> {
  const store = await getStore();
  const row: AiUsageLogRow = {
    id: genId('usage'),
    channelId: channel.id,
    channelName: channel.name,
    feature,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    ms: r.ms,
    createdAt: new Date().toISOString(),
  };
  await store.put('ai_usage_logs', row.id, row);
}

export async function listUsage(): Promise<AiUsageLogRow[]> {
  return (await (await getStore()).list<AiUsageLogRow>('ai_usage_logs')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------------- 生成/优化/翻译 ---------------- */

export interface FieldAiOptions {
  feature: string;
  systemPrompt: string;
  userPrompt: string;
  /** 期望 JSON 时给出 schema 描述 */
  jsonSchemaHint?: string;
  onDelta?: (delta: string, full: string) => void;
  signal?: AbortSignal;
  temperature?: number;
}

export async function runFieldAi(opts: FieldAiOptions): Promise<string> {
  const { client, channel } = await getActiveClient('text');
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userPrompt },
  ];
  const result = await client.chat({
    messages,
    onDelta: opts.onDelta,
    signal: opts.signal,
    temperature: opts.temperature,
    maxContinues: 2,
    ...(opts.jsonSchemaHint
      ? {}
      : {}),
  });
  await logUsage(channel, opts.feature, result);
  return result.text;
}

export async function runFieldAiJson<T>(opts: FieldAiOptions): Promise<T> {
  const { client, channel } = await getActiveClient('text');
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.jsonSchemaHint ? `${opts.userPrompt}\n\n只输出 JSON，结构：${opts.jsonSchemaHint}` : opts.userPrompt },
  ];
  const result = await client.chat({ messages, onDelta: opts.onDelta, signal: opts.signal, maxContinues: 2, jsonMode: true });
  await logUsage(channel, opts.feature, result);
  return extractJson<T>(result.text);
}
