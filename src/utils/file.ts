/** 文件读取/选择工具（浏览器 + Tauri webview 通用） */

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  text: string;
}

export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/** 弹出文件选择（拒绝则返回空数组） */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.oncancel = () => resolve([]);
    // Firefox 需要 append 才能触发 cancel
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

export async function pickJsonFiles(multiple = false): Promise<File[]> {
  return pickFiles('.json,application/json', multiple);
}

export async function pickPngFiles(multiple = false): Promise<File[]> {
  return pickFiles('.png,image/png', multiple);
}

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** 分块 base64 编码（字体等大文件，避免 String.fromCharCode 展开栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

/** 分块 base64 解码 */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'function') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'card';
}
