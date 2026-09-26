/**
 * AI 服务：渠道管理、统一调用入口（自动记用量）、按字段生成/优化/翻译、诊断 skill 执行。
 *
 * dev 分支增强（优化文档 P0-4）：
 * - 并发限制：所有 chat 调用经信号量排队（默认 2，可配）
 * - 全局系统提示词：渠道级 globalSystemPrompt 自动前插 system 消息
 */
import { getStore, genId } from '@/db';
import { LlmClient, extractJson, type ChannelConfig, type ChatMessage } from '@/core/llm';
import { fetchImplForPlatform } from '@/core/llm/tauriStream';
import { Semaphore } from '@/core/llm/semaphore';
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

/** 渠道行 → 客户端配置（桌面端自动走 Rust 流式代理 fetch） */
export function toChannelConfig(c: Pick<AiChannelRow, 'id' | 'name' | 'kind' | 'baseUrl' | 'apiKey' | 'modelId' | 'isActive'>): ChannelConfig {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    modelId: c.modelId,
    isActive: c.isActive,
  };
}

/** 构造 LlmClient（桌面端注入 Rust 流式代理，浏览器用原生 fetch） */
export function makeLlmClient(c: Pick<AiChannelRow, 'id' | 'name' | 'kind' | 'baseUrl' | 'apiKey' | 'modelId' | 'isActive'>): LlmClient {
  return new LlmClient(toChannelConfig(c), fetchImplForPlatform());
}

/** 当前激活渠道 → LlmClient */
export async function getActiveClient(kind: 'text' | 'image'): Promise<{ client: LlmClient; channel: AiChannelRow }> {
  const channels = await listChannels();
  const active = channels.find((c) => c.kind === kind && c.isActive) ?? channels.find((c) => c.kind === kind);
  if (!active) throw new Error(`没有可用的${kind === 'text' ? '文本' : '生图'}渠道，请先在 AI 中心配置`);
  return { client: makeLlmClient(active), channel: active };
}

/* ---------------- 并发限制 ---------------- */

const semaphores = new Map<string, Semaphore>();

export function getSemaphore(limit = 2): Semaphore {
  let s = semaphores.get('text');
  if (!s || s.limit !== limit) {
    s = new Semaphore(limit);
    semaphores.set('text', s);
  }
  return s;
}

/** 渠道全局系统提示词（自动前插） */
function withGlobalSystem(messages: ChatMessage[], channel: AiChannelRow): ChatMessage[] {
  const gsp = (channel as AiChannelRow & { globalSystemPrompt?: string }).globalSystemPrompt?.trim();
  if (!gsp) return messages;
  const hasSystem = messages.some((m) => m.role === 'system');
  if (hasSystem) {
    return messages.map((m, i) => (m.role === 'system' && i === 0 ? { role: 'system' as const, content: `${gsp}\n\n${m.content}` } : m));
  }
  return [{ role: 'system', content: gsp }, ...messages];
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
  /** 跳过并发限制（内部续写等） */
  bypassQueue?: boolean;
}

export async function runFieldAi(opts: FieldAiOptions): Promise<string> {
  const { client, channel } = await getActiveClient('text');
  const messages: ChatMessage[] = withGlobalSystem(
    [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    channel,
  );
  const limit = (channel as AiChannelRow & { concurrencyLimit?: number }).concurrencyLimit ?? 2;
  const sem = getSemaphore(limit);
  const exec = () =>
    client.chat({
      messages,
      onDelta: opts.onDelta,
      signal: opts.signal,
      temperature: opts.temperature,
      maxContinues: 2,
    });
  const result = opts.bypassQueue ? await exec() : await sem.run(exec);
  await logUsage(channel, opts.feature, result);
  return result.text;
}

export async function runFieldAiJson<T>(opts: FieldAiOptions): Promise<T> {
  const { client, channel } = await getActiveClient('text');
  const messages: ChatMessage[] = withGlobalSystem(
    [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.jsonSchemaHint ? `${opts.userPrompt}\n\n只输出 JSON，结构：${opts.jsonSchemaHint}` : opts.userPrompt },
    ],
    channel,
  );
  const limit = (channel as AiChannelRow & { concurrencyLimit?: number }).concurrencyLimit ?? 2;
  const sem = getSemaphore(limit);
  const exec = () =>
    client.chat({ messages, onDelta: opts.onDelta, signal: opts.signal, maxContinues: 2, jsonMode: true });
  const result = opts.bypassQueue ? await exec() : await sem.run(exec);
  await logUsage(channel, opts.feature, result);
  return extractJson<T>(result.text);
}
