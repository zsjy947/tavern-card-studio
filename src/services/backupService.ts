/**
 * 备份：全量导出/导入 zip（JSZip 打包所有表 JSON + 封面图）。
 * 已安装字体（fonts/font_blobs）不进备份：体积大且可随时重新下载/导入。
 */
import JSZip from 'jszip';
import { getStore } from '@/db';
import { resetSeededFlag } from './templateService';

/** 不参与备份的表 */
const BACKUP_EXCLUDED = new Set(['fonts', 'font_blobs']);

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

export async function importBackup(blob: Blob | Uint8Array, opts: { wipe?: boolean } = {}): Promise<{ tables: Record<string, number> }> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('不是有效的备份包（缺少 manifest.json）');
  const manifest = JSON.parse(await manifestFile.async('string')) as { app?: string };
  if (manifest.app !== 'tavern-card-studio') throw new Error('备份包不是 tavern-card-studio 生成的');

  const store = await getStore();
  const counts: Record<string, number> = {};
  let touchedTemplates = false;
  for (const file of Object.values(zip.files)) {
    const m = /^tables\/(.+)\.json$/.exec(file.name);
    if (!m) continue;
    const table = m[1]!;
    if (table === 'templates') touchedTemplates = true;
    const rows = JSON.parse(await file.async('string')) as { id: string }[];
    if (opts.wipe) await store.clear(table);
    await store.bulkPut(table, rows.map((r) => ({ id: r.id, value: r })));
    counts[table] = rows.length;
  }
  // wipe 导入会清掉 templates 表：复位播种标记，让内置模板在下次访问时重新补种
  if (touchedTemplates) resetSeededFlag();
  return { tables: counts };
}

/** 浏览器下载工具 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}
