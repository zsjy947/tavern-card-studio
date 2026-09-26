/**
 * 导出服务：统一文件落盘出口。
 * - 桌面（Tauri）：写入全局导出目录（设置可覆盖，默认 exe 同级 data/exports/），返回完整路径；
 * - 浏览器：回退 <a download> 下载，返回 null（无文件系统概念）。
 */
import { getSetting, setSetting, SETTING_KEYS } from './appSettings';
import { isTauri, tauriInvoke } from '@/db/tauri';
import { bytesToBase64 } from '@/utils/file';

let cachedDir: string | null = null;

/** 当前导出目录（自定义优先，否则 Rust 默认；进程内缓存） */
export async function getExportDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  const custom = await getSetting<string>(SETTING_KEYS.exportDir, '').catch(() => '');
  const dir = custom || (String(await tauriInvoke()('export_dir')));
  cachedDir = dir;
  return dir;
}

/** 覆盖导出目录（null = 恢复 Rust 默认） */
export async function setExportDir(dir: string | null): Promise<void> {
  await setSetting(SETTING_KEYS.exportDir, dir ?? '');
  cachedDir = null;
}

/** 弹系统文件夹选择框；取消返回 null */
export async function pickExportDir(): Promise<string | null> {
  const start = await getExportDir().catch(() => null);
  const picked = await tauriInvoke()('pick_export_dir', { startDir: start });
  return (picked as string | null) ?? null;
}

/** 在系统文件管理器打开导出目录 */
export async function openExportDir(): Promise<void> {
  const dir = await getExportDir();
  await tauriInvoke()('open_dir', { dir });
}

export interface SaveExportRequest {
  name: string;
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
}

/**
 * 保存导出文件。
 * 桌面端返回写入的完整路径；浏览器端执行下载并返回 null。
 */
export async function saveExportFile(req: SaveExportRequest): Promise<string | null> {
  if (!isTauri()) {
    const blob = req.bytes
      ? new Blob([req.bytes as BlobPart], { type: req.mime ?? 'application/octet-stream' })
      : new Blob([req.text ?? ''], { type: req.mime ?? 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = req.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return null;
  }
  const dir = await getExportDir();
  const bytes = req.bytes ?? new TextEncoder().encode(req.text ?? '');
  const b64 = bytesToBase64(bytes);
  const path = await tauriInvoke()('write_export', { dir, fileName: req.name, b64 });
  return String(path);
}
