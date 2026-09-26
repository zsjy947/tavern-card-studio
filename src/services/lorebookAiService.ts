/**
 * 世界书 AI 批量生成服务：批次循环编排（复用 runFieldAiJson + 流式 onDelta）。
 * - 每批 30 条，批间回传已生成名单防重复
 * - 批次级 429/失败重试：全程共享预算 3 次，等 15 秒后重试当前批
 *   （客户端已有请求级退避，本层只做批次级兜底，两者不叠加——429 在客户端重试耗尽后才会到这）
 * - 暂停/续跑：Promise 门（gate），abort 信号随时终止
 */
import * as aiService from './aiService';
import { LlmError } from '@/core/llm/client';
import {
  WB_BATCH_SIZE,
  WB_QUANTITY_TIERS as WB_TIERS,
  buildBatchSystemPrompt,
  buildBatchUserPrompt,
  isBatchComplete,
  normalizeBatchEntries,
  totalBatches,
  type RawWbEntry,
  type WorldbookGenParams,
} from '@/core/lorebook/generate';

export interface BatchGate {
  /** 暂停中：循环在批间等待 */
  isPaused(): boolean;
  /** 暂停时挂起；恢复/终止时 resolve */
  wait(): Promise<void>;
}

export interface BatchRunEvents {
  /** 每批完成回调（UI 进度） */
  onBatch?: (info: { batchIndex: number; totalBatches: number; batchEntries: RawWbEntry[]; totalEntries: number; done: boolean; note?: string }) => void;
  onDelta?: (delta: string, full: string) => void;
}

export interface BatchRunOptions extends BatchRunEvents {
  params: WorldbookGenParams;
  referenceNovel?: string;
  signal?: AbortSignal;
  gate?: BatchGate;
  /** 批次级共享重试预算（默认 3） */
  retryBudget?: number;
}

export interface BatchRunResult {
  entries: RawWbEntry[];
  /** true=提前完成（达到下限且 ≥80% 上限）；false=跑满批数 */
  earlyComplete: boolean;
  cancelled: boolean;
}

/** 生成模式 system/user 提示词（供「单条重生成」「继续补充」复用） */
export function batchPrompts(params: WorldbookGenParams, existingNames: string[], batchIndex: number, tierMax: number, referenceNovel?: string) {
  return {
    system: buildBatchSystemPrompt(params),
    user: buildBatchUserPrompt(params, existingNames, batchIndex, tierMax, referenceNovel),
  };
}

/** 运行批量生成（异步长任务；UI 通过 gate 暂停、signal 终止） */
export async function runWorldbookBatchGeneration(opts: BatchRunOptions): Promise<BatchRunResult> {
  const { params } = opts;
  const tier = WB_TIERS[Math.max(0, Math.min(WB_TIERS.length - 1, params.tierIndex))]!;
  const total = totalBatches(tier.max);
  const names = new Set<string>();
  const entries: RawWbEntry[] = [];
  let budget = opts.retryBudget ?? 3;
  let cancelled = false;
  let earlyComplete = false;

  const checkAbort = (): boolean => {
    if (opts.signal?.aborted) {
      cancelled = true;
      return true;
    }
    return false;
  };

  for (let batchIndex = 0; batchIndex < total; batchIndex++) {
    if (checkAbort()) break;
    // 暂停门：批间挂起
    if (opts.gate?.isPaused()) {
      await opts.gate.wait();
      if (checkAbort()) break;
    }
    if (isBatchComplete(entries.length, tier.min, tier.max)) {
      earlyComplete = true;
      break;
    }

    const user = buildBatchUserPrompt(params, [...names], batchIndex, tier.max, opts.referenceNovel);
    let batchEntries: RawWbEntry[] = [];
    let note: string | undefined;
    let retriesUsed = 0;

    // 批次级共享重试预算：单请求退避耗尽后仍失败 → 等 15s 重试本批
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await aiService.runFieldAiJson<unknown>({
          feature: 'worldbook:batch',
          systemPrompt: buildBatchSystemPrompt(params),
          userPrompt: user,
          onDelta: opts.onDelta,
          signal: opts.signal,
        });
        const norm = normalizeBatchEntries(raw, names);
        batchEntries = norm.entries;
        if (norm.allEmpty) note = '本批返回为空（可能截断或偷懒），已跳过';
        break;
      } catch (e) {
        const retryable = e instanceof LlmError ? e.retryable : true;
        if (checkAbort()) break;
        if (retriesUsed < budget && retryable) {
          retriesUsed++;
          budget--;
          note = `批次失败，15s 后重试本批（剩余预算 ${budget}）`;
          opts.onBatch?.({ batchIndex: batchIndex + 1, totalBatches: total, batchEntries: [], totalEntries: entries.length, done: false, note });
          await abortableSleep(15_000, opts.signal);
          if (checkAbort()) break;
          continue;
        }
        throw e;
      }
    }
    if (checkAbort()) break;

    entries.push(...batchEntries);
    const done = batchIndex + 1 >= total || isBatchComplete(entries.length, tier.min, tier.max);
    opts.onBatch?.({ batchIndex: batchIndex + 1, totalBatches: total, batchEntries, totalEntries: entries.length, done, note });
    if (done) {
      earlyComplete = isBatchComplete(entries.length, tier.min, tier.max);
      break;
    }
    // 批间隔（缓解 RPM 限制；可被 abort 打断）
    await abortableSleep(2000, opts.signal);
    if (checkAbort()) break;
  }

  return { entries, earlyComplete, cancelled };
}

/** 可被 abort 打断的 sleep（终止不再滞留 15s） */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export { WB_BATCH_SIZE, WB_TIERS };
