/**
 * 字体服务：从网络安装开源字体 / 本地导入字体文件，经 FontFace API 注册进文档。
 *
 * 存储分两种模式：
 * - 桌面端（Tauri）：字体文件落盘到便携数据目录 data/fonts/（自定义命令
 *   font_dir/font_write/font_read/font_delete），fonts 表只存元信息；
 * - 浏览器端：无文件系统，字节以 base64 存 font_blobs 表（IndexedDB）。
 * 字体不随备份导出（体积大且可随时重新下载/导入）。
 */
import JSZip from 'jszip';
import { getStore } from '@/db';
import { isTauri, tauriInvoke } from '@/db/tauri';
import { base64ToBytes, bytesToBase64 } from '@/utils/file';
import type { FontCatalogEntry } from '@/core/font';

export interface InstalledFontMeta {
  id: string;
  family: string;
  name: string;
  style: string;
  license: string;
  /** 字体文件字节数 */
  size: number;
  installedAt: string;
  source: 'catalog' | 'local';
  /** 桌面端落盘文件名（id + 嗅探出的扩展名）；浏览器模式为空串 */
  fileName: string;
  weight?: string;
}

const FONT_TABLE = 'fonts';
const BLOB_TABLE = 'font_blobs';

/** 已注册进 document.fonts 的 FontFace（id → face） */
const registered = new Map<string, FontFace>();

export function fontSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.FontFace === 'function';
}

export async function listInstalled(): Promise<InstalledFontMeta[]> {
  const read = async () => {
    const rows = await (await getStore()).list<InstalledFontMeta>(FONT_TABLE);
    return rows.sort((a, b) => a.installedAt.localeCompare(b.installedAt));
  };
  try {
    return await read();
  } catch (e) {
    // 启动期与其他初始化并发打同一个库时可能瞬时失败，重试一次自愈
    console.warn('字体列表读取失败，重试一次：', e);
    return read();
  }
}

/** 桌面端校验字体落盘文件是否存在（D4：轻量 try_exists+metadata，不再全量读文件验可读）；浏览器模式恒真（blob 在库内） */
export async function verifyFontFile(meta: InstalledFontMeta): Promise<boolean> {
  if (!isTauri()) return true;
  if (!meta.fileName) return false;
  try {
    const dir = await fontDir();
    const hit = (await tauriInvoke()('font_exists', { dir, name: meta.fileName })) as number | null;
    return hit != null;
  } catch {
    return false;
  }
}

export function isFontReady(id: string): boolean {
  return registered.has(id);
}

/** 依魔数嗅探字体格式（落盘扩展名用）：wOF2/wOFF/OTTO，其余按 ttf */
export function fontExtFromBytes(bytes: Uint8Array): string {
  const magic = (s: string) => s.split('').every((c, i) => bytes[i] === c.charCodeAt(0));
  if (magic('wOF2')) return '.woff2';
  if (magic('wOFF')) return '.woff';
  if (magic('OTTO')) return '.otf';
  return '.ttf';
}

interface TauriFontDir {
  (): Promise<string>;
}

let fontDirPromise: Promise<string> | undefined;
/** 桌面端字体目录（进程内缓存；失败不缓存，下次重试） */
const fontDir: TauriFontDir = () => {
  if (!fontDirPromise) {
    fontDirPromise = tauriInvoke()('font_dir')
      .then((v) => String(v))
      .catch((e) => {
        fontDirPromise = undefined;
        throw e;
      });
  }
  return fontDirPromise;
};

async function loadBlobRow(id: string): Promise<Uint8Array | undefined> {
  const row = await (await getStore()).get<{ id: string; b64: string }>(BLOB_TABLE, id);
  return row ? base64ToBytes(row.b64) : undefined;
}

async function loadBytes(meta: InstalledFontMeta): Promise<Uint8Array | undefined> {
  if (isTauri()) {
    if (!meta.fileName) return undefined;
    const dir = await fontDir();
    const buf = (await tauriInvoke()('font_read', { dir, name: meta.fileName })) as ArrayBuffer;
    return new Uint8Array(buf);
  }
  return loadBlobRow(meta.id);
}

/** 注册 FontFace（幂等；非浏览器环境静默跳过） */
async function registerFace(meta: InstalledFontMeta, bytes: Uint8Array): Promise<boolean> {
  if (!fontSupported() || registered.has(meta.id)) return registered.has(meta.id);
  const face = new FontFace(
    meta.family,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { weight: meta.weight ?? 'normal', display: 'swap' },
  );
  await face.load();
  document.fonts.add(face);
  registered.set(meta.id, face);
  return true;
}

/** 确保字体已注册可用（应用启动 / 切换字体时调用），返回是否成功 */
export async function ensureFontLoaded(id: string): Promise<boolean> {
  if (registered.has(id)) return true;
  const meta = await (await getStore()).get<InstalledFontMeta>(FONT_TABLE, id);
  if (!meta) return false;
  try {
    // 桌面端旧数据自愈：元信息缺 fileName（base64 时代遗留）时从 font_blobs 迁移落盘
    if (isTauri() && !meta.fileName) {
      const legacy = await loadBlobRow(id);
      if (!legacy) return false;
      await persist({ ...meta, fileName: `${id}${fontExtFromBytes(legacy)}` }, legacy);
      return registered.has(id);
    }
    const bytes = await loadBytes(meta);
    if (!bytes) return false;
    return await registerFace(meta, bytes);
  } catch (e) {
    console.error(`字体 ${meta.name} 注册失败：`, e);
    return false;
  }
}

async function persist(meta: InstalledFontMeta, bytes: Uint8Array): Promise<void> {
  const store = await getStore();
  await store.put(FONT_TABLE, meta.id, meta);
  if (isTauri()) {
    const dir = await fontDir();
    await tauriInvoke()('font_write', { dir, name: meta.fileName, b64: bytesToBase64(bytes) });
    await store.delete(BLOB_TABLE, meta.id).catch(() => undefined);
  } else {
    await store.put(BLOB_TABLE, meta.id, { id: meta.id, b64: bytesToBase64(bytes) });
  }
  await registerFace(meta, bytes);
}

export async function removeFont(id: string): Promise<void> {
  const store = await getStore();
  const meta = await store.get<InstalledFontMeta>(FONT_TABLE, id);
  await store.delete(FONT_TABLE, id);
  await store.delete(BLOB_TABLE, id);
  if (isTauri() && meta?.fileName) {
    await fontDir()
      .then((dir) => tauriInvoke()('font_delete', { dir, name: meta.fileName }))
      .catch(() => undefined);
  }
  const face = registered.get(id);
  if (face) {
    document.fonts.delete(face);
    registered.delete(id);
  }
}

/** 从本地文件导入（.ttf/.otf/.woff/.woff2） */
export async function importLocalFont(file: File): Promise<InstalledFontMeta> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '') || '本地字体';
  return installFromBytes({
    id: `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    family: base,
    name: base,
    style: '本地导入',
    license: '随文件',
  }, bytes, 'local');
}

async function installFromBytes(
  partial: Pick<InstalledFontMeta, 'id' | 'family' | 'name' | 'style' | 'license'> & { weight?: string },
  bytes: Uint8Array,
  source: InstalledFontMeta['source'],
): Promise<InstalledFontMeta> {
  if (bytes.length < 1000) throw new Error('文件过小，不是有效的字体文件');
  const meta: InstalledFontMeta = {
    ...partial,
    fileName: `${partial.id}${fontExtFromBytes(bytes)}`,
    size: bytes.length,
    installedAt: new Date().toISOString(),
    source,
  };
  await persist(meta, bytes);
  return meta;
}

/** 下载目录字体：逐个源尝试，任一成功即止；onProgress(已下载字节, 总字节|0) */
export async function downloadCatalogFont(
  entry: FontCatalogEntry,
  onProgress?: (loaded: number, total: number) => void,
): Promise<InstalledFontMeta> {
  let lastError: Error | undefined;
  let bytes: Uint8Array | undefined;
  for (const url of entry.urls) {
    try {
      bytes = await fetchBinary(url, onProgress);
      break;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (!bytes) {
    const hint = !isTauri() && entry.urls.some((u) => /github\.com\/.+\/releases\/download/.test(u))
      ? '（浏览器模式受跨域限制，Release 渠道字体请在桌面模式下载，或使用「导入本地字体」）'
      : '';
    throw new Error(`下载失败（已尝试 ${entry.urls.length} 个源）：${lastError?.message ?? '未知错误'}${hint}`);
  }
  if (entry.archive) bytes = await extractFontFromArchive(bytes);
  return installFromBytes({
    id: entry.id,
    family: entry.family,
    name: entry.name,
    style: entry.style,
    license: entry.license,
    weight: entry.weight,
  }, bytes, 'catalog');
}

async function fetchBinary(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  // 桌面模式经 Rust 命令直连官方源（无 CORS 限制，但拿不到流式进度）
  if (isTauri()) return fetchBinaryTauri(url, onProgress);
  return fetchBinaryWeb(url, onProgress);
}

async function fetchBinaryTauri(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const buf = (await tauriInvoke()('http_get_bytes', { url })) as ArrayBuffer;
  const out = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array();
  onProgress?.(out.length, out.length);
  return out;
}

async function fetchBinaryWeb(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(buf.length, buf.length);
    return buf;
  }
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** zip 压缩包 → 提取字体字节：优先 Regular，其次任一 ttf/otf */
export async function extractFontFromArchive(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const fontFiles = Object.values(zip.files).filter((f) => /\.(ttf|otf)$/i.test(f.name) && !f.dir);
  if (!fontFiles.length) throw new Error('压缩包中未找到字体文件（ttf/otf）');
  const pick = fontFiles.find((f) => /regular/i.test(f.name))
    ?? fontFiles.find((f) => !/mono|italic|bold|light|medium|black/i.test(f.name))
    ?? fontFiles[0]!;
  return pick.async('uint8array');
}
