/**
 * PNG tEXt chunk 手写解析/注入（无第三方依赖，浏览器/Node 通用）。
 *
 * 与 SillyTavern 行为对齐（src/character-card-parser.js）：
 * - 读取：优先 `ccv3`（V3），回退 `chara`（V2/V1）；base64 → UTF-8 JSON
 * - 写入：默认双写 `ccv3` + `chara`（RisuAI 风格，保证新旧前端都能识别）
 * - tEXt 文本以 \0 结尾；keyword 为 Latin-1，文本按 UTF-8 字节写（ST 同款宽容）
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export class PngFormatError extends Error {}

/* ---------------- CRC32 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- chunk 结构 ---------------- */

export interface PngChunk {
  name: string;
  data: Uint8Array;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function readU32(be: DataView, off: number): number {
  return be.getUint32(off, false);
}

function writeU32(view: DataView, off: number, v: number): void {
  view.setUint32(off, v >>> 0, false);
}

/** 解析 PNG 字节流为 chunk 列表（不含签名；IEND 之后的数据忽略） */
export function parsePng(bytes: Uint8Array): PngChunk[] {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new PngFormatError('不是有效的 PNG 文件（签名不匹配）');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = readU32(view, off);
    if (off + 12 + len > bytes.length) throw new PngFormatError('PNG chunk 长度越界，文件可能损坏');
    const name = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const data = bytes.subarray(off + 8, off + 8 + len);
    const crcExpected = readU32(view, off + 8 + len);
    if (name !== '____' && crc32(bytes.subarray(off + 4, off + 8 + len)) !== crcExpected) {
      throw new PngFormatError(`chunk ${name} CRC 校验失败`);
    }
    chunks.push({ name, data: new Uint8Array(data) });
    off += 12 + len;
    if (name === 'IEND') break;
  }
  if (!chunks.length) throw new PngFormatError('PNG 无有效 chunk');
  return chunks;
}

/** chunk 列表重新打包为 PNG 字节流 */
export function buildPng(chunks: PngChunk[]): Uint8Array {
  let total = 8;
  for (const c of chunks) total += 12 + c.data.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIG, 0);
  const view = new DataView(out.buffer);
  let off = 8;
  for (const c of chunks) {
    writeU32(view, off, c.data.length);
    const nameBytes = ascii(c.name);
    out.set(nameBytes, off + 4);
    out.set(c.data, off + 8);
    const crcInput = new Uint8Array(4 + c.data.length);
    crcInput.set(nameBytes, 0);
    crcInput.set(c.data, 4);
    writeU32(view, off + 8 + c.data.length, crc32(crcInput));
    off += 12 + c.data.length;
  }
  return out;
}

/* ---------------- tEXt 编解码 ---------------- */

export interface TextChunk {
  keyword: string;
  text: string;
}

export function decodeTextChunk(data: Uint8Array): TextChunk {
  const z = data.indexOf(0);
  if (z < 0) throw new PngFormatError('tEXt chunk 缺少分隔符');
  const kwBytes = data.subarray(0, z);
  const textBytes = data.subarray(z + 1);
  let keyword = '';
  for (const b of kwBytes) keyword += String.fromCharCode(b);
  // UTF-8 解码（对含 BOM 的宽容处理）
  return { keyword, text: utf8Decode(textBytes) };
}

export function encodeTextChunk(keyword: string, text: string): Uint8Array {
  const kw = ascii(keyword);
  const body = utf8Encode(text);
  const out = new Uint8Array(kw.length + 1 + body.length);
  out.set(kw, 0);
  out[kw.length] = 0;
  out.set(body, kw.length + 1);
  return out;
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(b);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // 浏览器/Node 双兼容
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

/* ---------------- 卡片元数据读写 ---------------- */

export interface ExtractedCard {
  /** 解析出的卡 JSON 原文（未归一化） */
  raw: unknown;
  /** 来自哪个 keyword */
  source: 'ccv3' | 'chara';
  /** 已知的其他 tEXt 关键字（诊断用） */
  otherKeywords: string[];
}

/**
 * 从 PNG 卡中抽取角色卡 JSON。
 * @throws PngFormatError PNG 损坏
 * @throws Error 无卡片元数据 / base64 或 JSON 无法解析
 */
export function extractCardFromPng(bytes: Uint8Array): ExtractedCard {
  const chunks = parsePng(bytes);
  const texts: TextChunk[] = [];
  for (const c of chunks) {
    if (c.name === 'tEXt') {
      try {
        texts.push(decodeTextChunk(c.data));
      } catch {
        /* 忽略畸形 tEXt */
      }
    }
  }
  const lower = (s: string) => s.toLowerCase();
  const ccv3 = texts.find((t) => lower(t.keyword) === 'ccv3');
  const chara = texts.find((t) => lower(t.keyword) === 'chara');
  const target = ccv3 ?? chara;
  if (!target) {
    const kws = texts.map((t) => t.keyword).join(', ') || '无';
    throw new Error(`PNG 中没有角色卡元数据（未找到 ccv3/chara tEXt 块；现有关键字：${kws}）`);
  }

  let text = target.text;
  // 宽容：部分工具写入时误加 data: 前缀或 URL 编码
  text = text.replace(/^data:.*?base64,/i, '');
  if (text.includes('%7B') || text.includes('%22')) {
    try {
      text = decodeURIComponent(text);
    } catch { /* 保留原文 */ }
  }

  let raw: unknown;
  // 先按 base64 → utf8 JSON 尝试
  let parsed = false;
  try {
    const jsonText = utf8Decode(fromBase64(text)).trim();
    if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
      raw = JSON.parse(jsonText);
      parsed = true;
    }
  } catch { /* 回退 */ }
  // 失败则按原文 JSON 尝试（个别卡直接写明文）
  if (!parsed) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      raw = JSON.parse(trimmed);
      parsed = true;
    }
  }
  if (!parsed) {
    throw new Error(`tEXt 块 "${target.keyword}" 既不是有效 base64 也不是明文 JSON`);
  }
  const otherKeywords = texts.filter((t) => t !== target).map((t) => t.keyword);
  return { raw, source: lower(target.keyword) === 'ccv3' ? 'ccv3' : 'chara', otherKeywords };
}

export interface InjectOptions {
  /** 双写 ccv3 + chara（默认 true，保证新旧前端兼容） */
  dualWrite?: boolean;
  /** 额外关键字 → 文本（如 chara_card_v2 兼容字段） */
  extraText?: Record<string, string>;
}

/**
 * 将卡片 JSON 注入 PNG 底图。
 * 移除已有 chara/ccv3 tEXt 块后在 IEND 前写入新块（保持 ST 读取顺序）。
 */
export function injectCardIntoPng(pngBytes: Uint8Array, cardJson: string, opts: InjectOptions = {}): Uint8Array {
  const dual = opts.dualWrite !== false;
  const chunks = parsePng(pngBytes);
  const kept = chunks.filter((c) => {
    if (c.name !== 'tEXt') return true;
    try {
      const { keyword } = decodeTextChunk(c.data);
      const k = keyword.toLowerCase();
      return k !== 'chara' && k !== 'ccv3';
    } catch {
      return true;
    }
  });
  // 找 IEND，插到它前面
  const iendIdx = kept.findIndex((c) => c.name === 'IEND');
  const insertAt = iendIdx >= 0 ? iendIdx : kept.length;
  const b64 = toBase64(utf8Encode(cardJson));
  const newTexts: PngChunk[] = [];
  if (dual) newTexts.push({ name: 'tEXt', data: encodeTextChunk('ccv3', b64) });
  newTexts.push({ name: 'tEXt', data: encodeTextChunk('chara', b64) });
  for (const [kw, text] of Object.entries(opts.extraText ?? {})) {
    newTexts.push({ name: 'tEXt', data: encodeTextChunk(kw, text) });
  }
  kept.splice(insertAt, 0, ...newTexts);
  return buildPng(kept);
}

/** 生成一张 1x1 或指定尺寸的纯色占位 PNG（无底图时导出用） */
export function makePlaceholderPng(size = 256, rgb: [number, number, number] = [124, 58, 237]): Uint8Array {
  // 最小 PNG：IHDR + IDAT(zlib stored) + IEND。手写 zlib store 块以零依赖。
  const w = size, h = size;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w, false);
  v.setUint32(4, h, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type truecolor
  // raw 扫描线：filter 0 + RGB
  const stride = 1 + w * 3;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const base = y * stride;
    for (let x = 0; x < w; x++) {
      const p = base + 1 + x * 3;
      raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2];
    }
  }
  const idat = zlibStore(raw);
  return buildPng([
    { name: 'IHDR', data: ihdr },
    { name: 'IDAT', data: idat },
    { name: 'IEND', data: new Uint8Array(0) },
  ]);
}

/** 无压缩 zlib（stored blocks，含 adler32）——仅为占位图，不需要压缩率 */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 65535) || 1;
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  let off = 0;
  out[off++] = 0x78; out[off++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const end = Math.min(start + 65535, data.length);
    const final = i === blocks - 1 ? 1 : 0;
    out[off++] = final;
    const len = end - start;
    out[off++] = len & 0xff; out[off++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[off++] = nlen & 0xff; out[off++] = (nlen >>> 8) & 0xff;
    out.set(data.subarray(start, end), off);
    off += len;
  }
  const a = adler32(data);
  const dv = new DataView(out.buffer);
  dv.setUint32(off, a, false);
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
