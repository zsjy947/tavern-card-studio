/**
 * 生成 src-tauri/icons/icon.png（1024×1024 RGBA，zlib 无依赖手写 PNG）。
 * 视觉：紫粉渐变圆角底 + 深色卡片 + 文本条 + 绿色对勾徽标（与 public/icon.svg 同族）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const S = 1024;
const px = Buffer.alloc(S * S * 4);

function setPixel(x, y, r, g, b, a) {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  if (x >= x0 + r && x <= x1 - r) return true;
  if (y >= y0 + r && y <= y1 - r) return true;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSeg(px0, py0, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px0 - ax, apy = py0 - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const dx = apx - t * abx, dy = apy - t * aby;
  return Math.hypot(dx, dy);
}

const lerp = (a, b, t) => a + (b - a) * t;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // 底：圆角方形渐变（#8b5cf6 → #d946ef，对角）
    if (insideRoundRect(x, y, 32, 32, S - 32, S - 32, 200)) {
      const t = (x + y) / (2 * S);
      let r = Math.round(lerp(139, 217, t));
      let g = Math.round(lerp(92, 70, t));
      let b = Math.round(lerp(246, 239, t));
      // 深色卡片
      if (insideRoundRect(x, y, 220, 250, 804, 900, 56)) {
        r = 20; g = 16; b = 28;
        // 卡片上的文本条
        const bars = [[270, 330, 620], [270, 396, 560], [270, 462, 480], [270, 528, 300]];
        for (const [bx, by, bw] of bars) {
          if (x >= bx && x <= bx + bw && y >= by && y <= by + 26) {
            r = 216; g = 200; b = 252; break;
          }
        }
      }
      // 绿色徽标圆 + 深色对勾
      const dcx = 726, dcy = 764, dr = 150;
      const d = Math.hypot(x - dcx, y - dcy);
      if (d <= dr) {
        r = 74; g = 222; b = 128;
        const dCheck = Math.min(
          distToSeg(x, y, dcx - 58, dcy + 6, dcx - 14, dcy + 50),
          distToSeg(x, y, dcx - 14, dcy + 50, dcx + 62, dcy - 46),
        );
        if (dCheck <= 17) { r = 16; g = 16; b = 22; }
      }
      setPixel(x, y, r, g, b, 255);
    } else {
      setPixel(x, y, 0, 0, 0, 0);
    }
  }
}

// 打包 PNG
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(name, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('src-tauri/icons', { recursive: true });
writeFileSync('src-tauri/icons/icon.png', png);
console.log(`icon.png written: ${png.length} bytes`);
