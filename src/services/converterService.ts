/**
 * 最近转换服务：元数据持久化（settings）+ 进程内产物缓存（≤2MB）+ 重新下载。
 */
import { getStore, genId } from '@/db';
import { getSetting, setSetting, SETTING_KEYS } from './appSettings';
import { saveExportFile } from './exportService';
import { pushRecent, shouldKeepProduct, type RecentConversion, type ConvertDirection } from '@/core/converter/recent';

/** 进程内产物缓存（会话级，重启即失；超限不缓存） */
const products = new Map<string, { bytes: Uint8Array; mime: string }>();

export async function listRecentConversions(): Promise<RecentConversion[]> {
  return getSetting<RecentConversion[]>(SETTING_KEYS.recentConversions, []);
}

export async function recordConversion(input: {
  direction: ConvertDirection;
  fileName: string;
  cardName: string;
  spec: string;
  outputName: string;
  bytes: Uint8Array;
  mime: string;
  savedPath?: string | null;
}): Promise<RecentConversion> {
  const entry: RecentConversion = {
    id: genId('conv'),
    direction: input.direction,
    fileName: input.fileName,
    cardName: input.cardName,
    spec: input.spec,
    sizeBytes: input.bytes.length,
    savedAt: new Date().toISOString(),
    savedPath: input.savedPath ?? null,
    outputName: input.outputName,
  };
  const store = await getStore();
  await store.put('settings', SETTING_KEYS.recentConversions, {
    id: SETTING_KEYS.recentConversions,
    value: pushRecent(await listRecentConversions(), entry),
  });
  if (shouldKeepProduct(entry.sizeBytes)) {
    products.set(entry.id, { bytes: input.bytes, mime: input.mime });
  }
  // 缓存容量防御：只保留最近 50 条对应的产物
  while (products.size > 50) {
    const oldest = products.keys().next().value;
    if (oldest === undefined) break;
    products.delete(oldest);
  }
  return entry;
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
