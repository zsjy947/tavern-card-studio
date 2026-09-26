/**
 * 小说 5 类轨迹提取服务：逐片 × 逐类 AI 调用编排 + 断点续跑 + 每类完成后的自检修正。
 * 引擎（prompt/切片/归一化/转换）在 core/novel/extract5（纯函数）；本层负责 AI 编排与状态存续。
 * 断点续跑复用工坊 pipelineState 思路：状态由调用方持有，本服务按 (chunkIndex, type) 粒度推进。
 */
import * as aiService from './aiService';
import { extractJson } from '@/core/llm';
import {
  SELF_CHECK_PROMPT,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  chunkNovel,
  emptyExtraction,
  normalizeExtractionArray,
  type ExtractConfig,
  type ExtractType,
  type NovelChunk,
  type NovelExtraction,
} from '@/core/novel/extract5';

/** 提取进度快照（工坊 pipelineState / 编辑器面板共用） */
export interface ExtractState {
  config: ExtractConfig;
  /** 分片缓存（断点续跑无需重新切片） */
  chunks: { text: string; strategy: 'chapter' | 'words'; range: string }[];
  extraction: NovelExtraction;
  /** 已完成的 (chunkIndex:type) 键 */
  doneKeys: string[];
  /** 最近一次自检的时间标记（仅展示用） */
  selfCheckedTypes: ExtractType[];
}

export function initExtractState(config: ExtractConfig, novelText: string): ExtractState {
  const result = chunkNovel(novelText, config);
  return {
    config,
    chunks: result.chunks.map((c: NovelChunk) => ({ text: c.text, strategy: c.strategy, range: c.range })),
    extraction: emptyExtraction(),
    doneKeys: [],
    selfCheckedTypes: [],
  };
}

export function extractProgress(state: ExtractState): { done: number; total: number } {
  const types = state.config.selectedTypes;
  return { done: state.doneKeys.length, total: state.chunks.length * types.length };
}

/** 单片单类提取（无状态纯调用，供断点续跑逐键补跑） */
export async function extractOne(
  state: ExtractState,
  chunkIndex: number,
  type: ExtractType,
  opts: { onDelta?: (delta: string, full: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const key = `${chunkIndex}:${type}`;
  if (state.doneKeys.includes(key)) return;
  const chunk = state.chunks[chunkIndex];
  if (!chunk) throw new Error(`分片不存在：${chunkIndex}`);
  // 跨片衔接：把已有同类结果的名字清单作为摘要传入，减少重复
  const prevSummary = buildPrevSummary(state, type);
  const raw = await aiService.runFieldAiJson<unknown>({
    feature: `novel:extract5-${type}`,
    systemPrompt: buildExtractSystemPrompt(type, state.config),
    userPrompt: buildExtractUserPrompt(type, chunk.text, prevSummary),
    jsonSchemaHint: '对象数组',
    onDelta: opts.onDelta,
    signal: opts.signal,
  });
  const items = normalizeExtractionArray<unknown>(raw, type);
  mergeIntoExtraction(state.extraction, type, items);
  state.doneKeys.push(key);
}

/** 每类全部完成后调用一次 AI 自检修正 */
export async function selfCheckType(
  state: ExtractState,
  type: ExtractType,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const current = (state.extraction as unknown as Record<string, unknown>)[type];
  if (!Array.isArray(current) || current.length === 0) return;
  try {
    const fixed = await aiService.runFieldAiJson<unknown>({
      feature: `novel:extract5-selfcheck`,
      systemPrompt: SELF_CHECK_PROMPT,
      userPrompt: `【上一步提取结果】\n${JSON.stringify(current, null, 2)}`,
      signal: opts.signal,
      bypassQueue: true,
    });
    // 自检失败不致命：保持原结果
    const items = normalizeExtractionArray<unknown>(extractJson<unknown>(JSON.stringify(fixed)) ?? fixed, type);
    if (items.length > 0) {
      (state.extraction as unknown as Record<string, unknown>)[type] = items;
      if (!state.selfCheckedTypes.includes(type)) state.selfCheckedTypes.push(type);
    }
  } catch {
    /* 自检失败保持原结果 */
  }
}

function buildPrevSummary(state: ExtractState, type: ExtractType): string {
  const ex = state.extraction as unknown as Record<string, unknown[]>;
  const arr = ex[type] ?? [];
  if (!arr.length) return '';
  const names = arr
    .map((x) => (x && typeof x === 'object' ? ((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).item_name ?? (x as Record<string, unknown>).stage_name ?? '') : ''))
    .filter(Boolean)
    .slice(0, 30);
  return names.length ? `已提取（勿重复）：${names.join('、')}` : '';
}

function mergeIntoExtraction(extraction: NovelExtraction, type: ExtractType, items: unknown[]): void {
  const key = type as keyof NovelExtraction;
  const existing = extraction[key] as unknown[];
  const seen = new Set(existing.map((x) => JSON.stringify(x)));
  for (const item of items) {
    const sig = JSON.stringify(item);
    if (!seen.has(sig)) {
      seen.add(sig);
      existing.push(item);
    }
  }
}
