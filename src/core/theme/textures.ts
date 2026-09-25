/**
 * 背景纹理生成：全部为内联 SVG data URL，无外部资源、可离线使用。
 * 纹理整体控制在极低对比度（4%~14% 不透明度），只提供「质感」而不干扰阅读。
 */

/** SVG 字符串 → CSS url() data URL */
function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * 纸张颗粒噪声（feTurbulence 分形噪声染色）。
 * @param rgb 染色 RGB，如 '93, 74, 50'
 * @param alpha 噪声最大不透明度（0~1）
 */
export function grainTexture(rgb: string, alpha: number, size = 220, seed = 7): string {
  const [r, g, b] = rgb.split(',').map((s) => Number(s.trim()) / 255);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${alpha} 0"/></filter>` +
    `<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return svgUrl(svg);
}

/**
 * 竹影纹样：竹竿（带节的分段圆杆）+ 垂叶，平铺使用。
 * 颜色固定为深竹青，靠低不透明度融入浅绿底色。
 */
export function bambooTexture(size = 460): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 460 460">` +
    `<g fill="#2e6b45">` +
    // 左侧主竹竿：三段 + 竿节
    `<g opacity="0.10">` +
    `<rect x="52" y="-16" width="16" height="146" rx="8"/>` +
    `<rect x="52" y="142" width="16" height="146" rx="8"/>` +
    `<rect x="52" y="300" width="16" height="146" rx="8"/>` +
    `<rect x="49" y="124" width="22" height="6" rx="3" opacity="0.9"/>` +
    `<rect x="49" y="282" width="22" height="6" rx="3" opacity="0.9"/>` +
    `<rect x="49" y="440" width="22" height="6" rx="3" opacity="0.9"/>` +
    `</g>` +
    // 右侧细竿
    `<g opacity="0.07">` +
    `<rect x="356" y="36" width="11" height="118" rx="5.5"/>` +
    `<rect x="356" y="166" width="11" height="118" rx="5.5"/>` +
    `<rect x="356" y="296" width="11" height="118" rx="5.5"/>` +
    `</g>` +
    // 叶簇：细长垂叶，三两成组
    `<g opacity="0.13">` +
    `<path d="M120 90 C 138 74, 168 66, 196 70 C 172 84, 142 92, 120 90 Z"/>` +
    `<path d="M124 96 C 146 108, 168 130, 178 156 C 154 138, 132 116, 124 96 Z"/>` +
    `<path d="M118 84 C 102 68, 78 60, 52 64 C 74 76, 100 84, 118 84 Z"/>` +
    `</g>` +
    `<g opacity="0.11" transform="translate(392 208) rotate(16)">` +
    `<path d="M0 0 C 16 -14, 42 -20, 66 -16 C 46 -4, 18 2, 0 0 Z"/>` +
    `<path d="M2 6 C 20 18, 34 38, 40 60 C 22 44, 8 24, 2 6 Z"/>` +
    `</g>` +
    `<g opacity="0.10" transform="translate(150 352) rotate(-10)">` +
    `<path d="M0 0 C 20 -12, 48 -14, 72 -6 C 48 4, 20 6, 0 0 Z"/>` +
    `<path d="M4 8 C 22 22, 32 44, 34 66 C 20 48, 8 28, 4 8 Z"/>` +
    `</g>` +
    `</g></svg>`;
  return svgUrl(svg);
}

/**
 * 墨韵渍染：两团极淡的青蓝晕染（大半径径向渐变），营造宣纸上的墨气。
 */
export function inkWashTexture(): string {
  return 'radial-gradient(1100px 640px at 88% -8%, rgba(111, 159, 200, 0.08), transparent 62%),' +
    'radial-gradient(900px 620px at -6% 104%, rgba(111, 159, 200, 0.05), transparent 58%)';
}

/**
 * 顶部柔光：纸张上缘的一层淡光晕，给「纸」增加纵深。
 */
export function paperGlow(): string {
  return 'radial-gradient(130% 90% at 50% -10%, rgba(255, 248, 228, 0.55), transparent 60%)';
}
