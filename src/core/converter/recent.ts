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
  /** 同一次批量 run 的批次 id（单文件转换无此字段） */
  batchId?: string;
  /** per-file 结果：failed=失败（断点续跑不跳过、可重试）；旧记录缺省视为 ok */
  status?: 'ok' | 'failed';
  /** status=failed 时的错误信息 */
  error?: string;
  /** 源文件内容指纹（bytesHash），断点续跑防同名不同文件误跳 */
  sourceHash?: string;
}

/** 一次批量转换 run（断点续跑依据：finishedAt 缺失 = 中断未完成） */
export interface BatchRun {
  id: string;
  direction: ConvertDirection;
  total: number;
  startedAt: string;
  /** 正常跑完（zip 已产出）才有 */
  finishedAt?: string;
  /** 批末 zip 落盘路径（桌面端） */
  zipPath?: string | null;
}

/** 源文件指纹（FNV-1a 32bit，非安全场景足够）：断点续跑防同名不同文件误跳 */
export function bytesHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
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
