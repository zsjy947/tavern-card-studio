/**
 * 主题模型：纯数据定义，无框架 / DOM 依赖。
 *
 * 每套主题 = 调色板（映射为 CSS 变量）+ 明暗模式（决定 naive-ui 基础主题）
 * + 可选背景纹理（background-image 值，通常为内联 SVG data URL）。
 */

export type ThemeMode = 'dark' | 'light';

export interface ThemePalette {
  /** 应用最底层底色（纹理之下、所有面板之后） */
  bg: string;
  /** 内容区底色（naive bodyColor） */
  content: string;
  /** 卡片 / 弹窗 / 浮层底色（naive card/modal/popover） */
  surface: string;
  /** 命令面板等自绘浮层底色 */
  overlay: string;
  /** 输入框底色（naive inputColor） */
  input: string;
  /** 自定义面板描边 / 分割线 */
  border: string;
  /** 弱填充（次级面板底色，比表面略深/略浅一档） */
  fill: string;
  /** 极弱填充（悬浮卡片、置顶栏底色） */
  fillSoft: string;
  /** 文本三级灰阶 */
  text1: string;
  text2: string;
  text3: string;
  /** 强调色族：主色 / 悬停 / 按下 / 柔和填充 / 柔和描边 / 强调文本 */
  accent: string;
  accentHover: string;
  accentPressed: string;
  accentSoft: string;
  accentBorder: string;
  accentText: string;
  /** 语义状态色：通过 / 警告 / 危险 */
  good: string;
  warn: string;
  bad: string;
  /** 代码编辑器底色与活动行底色 */
  editorBg: string;
  editorActive: string;
  /** 卡封面占位底色 */
  coverBg: string;
  /** 品牌字渐变（background 简写值） */
  brandGrad: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  palette: ThemePalette;
  /**
   * 背景纹理（background-image 值，可逗号分隔多层；'none' 表示无）。
   * 由 App.vue 写入 --tcs-texture，铺满整个应用底面。
   */
  texture: string;
}

/** 供 JS 侧取状态色（NProgress :color 等需要具体色值的场景） */
export function statusColorsOf(t: ThemeDefinition): { good: string; warn: string; bad: string } {
  return { good: t.palette.good, warn: t.palette.warn, bad: t.palette.bad };
}

/** 主题 → CSS 自定义属性映射（写入 documentElement） */
export function cssVarsOf(t: ThemeDefinition): Record<string, string> {
  const p = t.palette;
  return {
    '--tcs-bg': p.bg,
    '--tcs-content': p.content,
    '--tcs-surface': p.surface,
    '--tcs-overlay': p.overlay,
    '--tcs-input': p.input,
    '--tcs-border': p.border,
    '--tcs-fill': p.fill,
    '--tcs-fill-soft': p.fillSoft,
    '--tcs-text-1': p.text1,
    '--tcs-text-2': p.text2,
    '--tcs-text-3': p.text3,
    '--tcs-accent': p.accent,
    '--tcs-accent-hover': p.accentHover,
    '--tcs-accent-pressed': p.accentPressed,
    '--tcs-accent-soft': p.accentSoft,
    '--tcs-accent-border': p.accentBorder,
    '--tcs-accent-text': p.accentText,
    '--tcs-good': p.good,
    '--tcs-warn': p.warn,
    '--tcs-bad': p.bad,
    '--tcs-editor-bg': p.editorBg,
    '--tcs-editor-active': p.editorActive,
    '--tcs-cover-bg': p.coverBg,
    '--tcs-brand-grad': p.brandGrad,
    '--tcs-texture': t.texture,
  };
}
