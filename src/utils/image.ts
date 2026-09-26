/** 封面图片工具：选图压缩 + data URL 解码（浏览器与 Tauri webview 通用） */
import { base64ToBytes } from './file';

/**
 * 图片文件 → 封面 data URL（等比缩放到 max 内，防止大图塞爆数据库行）。
 * PNG 输入保持 PNG（保透明），其余输出 JPEG。
 */
export async function imageFileToCoverDataUrl(file: File, max = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const keepPng = /^image\/png$/i.test(file.type);
    return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    bitmap.close();
  }
}

/** data URL base64 形态 → 字节；非 data URL 或解析失败返回 null */
export function dataUrlToBytes(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) return null;
  const m = /^data:[^,]*;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return base64ToBytes(m[1]!);
  } catch {
    return null;
  }
}
