/**
 * 转换器「最近转换」记录（ROADMAP P1-4）：元数据落 settings（上限 50 淘汰最老），
 * ≤2MB 的转换产物保留在进程内存供「重新下载」，>2MB 只记元数据。
 */

export const RECENT_CAP = 50;
/** >2MB 不保留产物（对齐 ROADMAP 原约束） */
export const PRODUCT_KEEP_LIMIT = 2 * 1024 * 1024;

export type ConvertDirection = 'png2json' | 'json2png';

export interface RecentConversion {
  id: string;
  direction: ConvertDirection;
  /** 源文件名 */
  fileName: string;
  /** 卡名 */
  cardName: string;
  spec: string;
  sizeBytes: number;
  savedAt: string;
  /** 桌面端导出落盘路径（浏览器端为 null） */
  savedPath?: string | null;
  /** 产物文件名（如 xxx.json / xxx.png） */
  outputName: string;
}

/** 新记录入列（最新在前，超上限淘汰最老；同 id 幂等） */
export function pushRecent(list: RecentConversion[], entry: RecentConversion, cap = RECENT_CAP): RecentConversion[] {
  const next = [entry, ...list.filter((x) => x.id !== entry.id)];
  return next.length > cap ? next.slice(0, cap) : next;
}

/** 是否保留产物（≤2MB 保留，供「重新下载」） */
export function shouldKeepProduct(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= PRODUCT_KEEP_LIMIT;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
