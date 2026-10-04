/**
 * 备份：全量导出/导入 zip（JSZip 打包所有表 JSON + 封面图）。
 * 已安装字体（fonts/font_blobs）不进备份：体积大且可随时重新下载/导入。
 */
import JSZip from 'jszip';
import { getStore } from '@/db';
import { TABLES } from '@/db/store';
import { resetSeededFlag } from './templateService';

/** 不参与备份的表 */
const BACKUP_EXCLUDED = new Set(['fonts', 'font_blobs']);

/** 导入白名单 = 导出会写出的表。表名会被拼进 SQL（replaceAll 的
 *  DELETE/INSERT），来自 zip 的任意名字绝不能直接透传。 */
const IMPORTABLE_TABLES = new Set<string>(TABLES.filter((t) => !BACKUP_EXCLUDED.has(t)));

export async function exportBackup(): Promise<Blob> {
  const store = await getStore();
  const dump = await store.dump();
  const zip = new JSZip();
  const tables = Object.fromEntries(Object.entries(dump).filter(([k]) => !BACKUP_EXCLUDED.has(k)));
  zip.file('manifest.json', JSON.stringify({
    app: 'tavern-card-studio',
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
  }, null, 2));
  for (const [table, rows] of Object.entries(tables)) {
    zip.file(`tables/${table}.json`, JSON.stringify(rows));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function importBackup(
  blob: Blob | Uint8Array,
  opts: { wipe?: boolean } = {},
): Promise<{ tables: Record<string, number>; skipped: Record<string, number> }> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('不是有效的备份包（缺少 manifest.json）');
  const manifest = JSON.parse(await manifestFile.async('string')) as { app?: string };
  if (manifest.app !== 'tavern-card-studio') throw new Error('备份包不是 tavern-card-studio 生成的');

  const store = await getStore();
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  let touchedTemplates = false;
  for (const file of Object.values(zip.files)) {
    const m = /^tables\/(.+)\.json$/.exec(file.name);
    if (!m) continue;
    const table = m[1]!;
    // 白名单拦截：未知表名直接报错拒绝导入（不静默跳过）
    if (!IMPORTABLE_TABLES.has(table)) {
      throw new Error(`备份包含未知表「${table}」，已拒绝导入（仅支持：${[...IMPORTABLE_TABLES].join('、')}）`);
    }
    if (table === 'templates') touchedTemplates = true;
    const rows = JSON.parse(await file.async('string')) as unknown[];
    // 行校验：非对象 / 无 id / id 非字符串的坏行过滤掉并计数（F2）
    const valid = rows.filter((r): r is { id: string } =>
      !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && (r as { id: string }).id !== '');
    const bad = rows.length - valid.length;
    if (opts.wipe) await store.replaceAll(table, valid.map((r) => ({ id: r.id, value: r })));
    else await store.bulkPut(table, valid.map((r) => ({ id: r.id, value: r })));
    counts[table] = valid.length;
    if (bad > 0) skipped[table] = bad;
  }
  // wipe 导入会清掉 templates 表：复位播种标记，让内置模板在下次访问时重新补种
  if (touchedTemplates) resetSeededFlag();
  return { tables: counts, skipped };
}

/** 浏览器下载工具 / 桌面端写全局导出目录（见 exportService） */
import { saveExportFile } from './exportService';

/**
 * 保存 blob。桌面端返回写入的完整路径；浏览器端走 <a download> 返回 null。
 * 历史函数名保留 download*，调用方按需 await 获取路径。
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<string | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return saveExportFile({ name: filename, bytes, mime: blob.type || 'application/octet-stream' });
}

export async function downloadText(text: string, filename: string, mime = 'application/json'): Promise<string | null> {
  return saveExportFile({ name: filename, text, mime });
}

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}
