/**
 * 最近转换服务：元数据持久化（settings）+ 进程内产物缓存（≤2MB）+ 重新下载 + 批量 run 记录（断点续跑）。
 */
import { getStore, genId } from '@/db';
import { getSetting, setSetting, SETTING_KEYS } from './appSettings';
import { saveExportFile } from './exportService';
import { pushRecent, shouldKeepProduct, type RecentConversion, type BatchRun, type ConvertDirection } from '@/core/converter/recent';

/** 进程内产物缓存（会话级，重启即失；超限不缓存） */
const products = new Map<string, { bytes: Uint8Array; mime: string }>();

/** 批量 run 记录上限（只留最近几次，够断点续跑定位即可） */
const BATCH_RUN_CAP = 5;

export async function listRecentConversions(): Promise<RecentConversion[]> {
  return getSetting<RecentConversion[]>(SETTING_KEYS.recentConversions, []);
}

export async function recordConversion(input: {
  direction: ConvertDirection;
  fileName: string;
  cardName: string;
  spec: string;
  outputName: string;
  /** 失败留痕时无产物，可省略（sizeBytes=0，不入产物缓存） */
  bytes?: Uint8Array;
  mime?: string;
  savedPath?: string | null;
  batchId?: string;
  status?: 'ok' | 'failed';
  error?: string;
  sourceHash?: string;
}): Promise<RecentConversion> {
  const entry: RecentConversion = {
    id: genId('conv'),
    direction: input.direction,
    fileName: input.fileName,
    cardName: input.cardName,
    spec: input.spec,
    sizeBytes: input.bytes?.length ?? 0,
    savedAt: new Date().toISOString(),
    savedPath: input.savedPath ?? null,
    outputName: input.outputName,
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
  };
  const store = await getStore();
  await store.put('settings', SETTING_KEYS.recentConversions, {
    id: SETTING_KEYS.recentConversions,
    value: pushRecent(await listRecentConversions(), entry),
  });
  if (input.bytes && shouldKeepProduct(entry.sizeBytes)) {
    products.set(entry.id, { bytes: input.bytes, mime: input.mime ?? 'application/octet-stream' });
  }
  // 缓存容量防御：只保留最近 50 条对应的产物
  while (products.size > 50) {
    const oldest = products.keys().next().value;
    if (oldest === undefined) break;
    products.delete(oldest);
  }
  return entry;
}

/* ---------------- 批量 run 记录（断点续跑，ROADMAP §三.4） ---------------- */

export async function listBatchRuns(): Promise<BatchRun[]> {
  return getSetting<BatchRun[]>(SETTING_KEYS.recentBatchRuns, []);
}

/** 登记批量 run（upsert：同 id 覆盖并置顶，上限 5 淘汰最老） */
export async function recordBatchRun(run: BatchRun): Promise<void> {
  const store = await getStore();
  await store.put('settings', SETTING_KEYS.recentBatchRuns, {
    id: SETTING_KEYS.recentBatchRuns,
    value: [run, ...(await listBatchRuns()).filter((r) => r.id !== run.id)].slice(0, BATCH_RUN_CAP),
  });
}

/** 断点续跑用：取进程内保留的转换产物（无则 null） */
export function getProduct(id: string): { bytes: Uint8Array; mime: string } | null {
  return products.get(id) ?? null;
}

/** 重新下载：内存有产物则走导出流程；无产物（过大或会话已结束）抛错 */
export async function reDownloadConversion(entry: RecentConversion): Promise<string | null> {
  const product = products.get(entry.id);
  if (!product) throw new Error('该记录的产物未保留（>2MB 或重启后），请重新转换');
  return saveExportFile({ name: entry.outputName, bytes: product.bytes, mime: product.mime });
}

/** 单测注入 / 清空缓存 */
export function clearProductCache(): void {
  products.clear();
}
