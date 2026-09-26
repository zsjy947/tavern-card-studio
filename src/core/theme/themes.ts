/**
 * 内置主题：暗夜（默认深色）/ 晨白（浅色）/ 三套文学氛围主题。
 * 色板取值原则：正文对比度 ≥ 7:1，纹理层不透明度 ≤ 14%，强调色同时用于 naive 主色。
 */
import { bambooTexture, grainTexture, inkWashTexture, paperGlow } from './textures';
import type { ThemeDefinition } from './model';

/** 暗夜 · 幽紫：默认深色（保持历史外观） */
const dark: ThemeDefinition = {
  id: 'dark',
  label: '暗夜 · 幽紫',
  description: '默认深色，紫罗兰强调',
  mode: 'dark',
  palette: {
    bg: '#101014',
    content: '#101014',
    surface: '#18181c',
    overlay: '#18181f',
    input: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.09)',
    fill: 'rgba(255, 255, 255, 0.03)',
    fillSoft: 'rgba(255, 255, 255, 0.02)',
    text1: '#ececf1',
    text2: '#c9c9d4',
    text3: '#8b8b96',
    accent: '#8b5cf6',
    accentHover: '#a78bfa',
    accentPressed: '#7c3aed',
    accentSoft: 'rgba(139, 92, 246, 0.12)',
    accentBorder: 'rgba(139, 92, 246, 0.35)',
    accentText: '#c4b5fd',
    good: '#4ade80',
    warn: '#facc15',
    bad: '#f87171',
    editorBg: '#282c34',
    editorActive: 'rgba(255, 255, 255, 0.035)',
    coverBg: '#1a1a22',
    brandGrad: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
  },
  texture: 'none',
};

/** 晨白：清爽浅色 */
const light: ThemeDefinition = {
  id: 'light',
  label: '晨白',
  description: '清爽浅色，高对比阅读',
  mode: 'light',
  palette: {
    bg: '#eef0f4',
    content: '#f2f3f7',
    surface: '#ffffff',
    overlay: '#ffffff',
    input: '#ffffff',
    border: 'rgba(31, 35, 44, 0.14)',
    fill: 'rgba(31, 35, 44, 0.03)',
    fillSoft: 'rgba(31, 35, 44, 0.02)',
    text1: '#1f2328',
    text2: '#49505f',
    text3: '#8a90a0',
    accent: '#7c3aed',
    accentHover: '#8b5cf6',
    accentPressed: '#6d28d9',
    accentSoft: 'rgba(124, 58, 237, 0.08)',
    accentBorder: 'rgba(124, 58, 237, 0.32)',
    accentText: '#6d28d9',
    good: '#16a34a',
    warn: '#d97706',
    bad: '#dc2626',
    editorBg: '#fbfbfd',
    editorActive: 'rgba(31, 35, 44, 0.04)',
    coverBg: '#e7e9ef',
    brandGrad: 'linear-gradient(135deg, #7c3aed, #c026d3)',
  },
  texture: 'none',
};

/** 书卷 · 纸墨：米棕纸纹，旧书氛围 */
const sepia: ThemeDefinition = {
  id: 'sepia',
  label: '书卷 · 纸墨',
  description: '米棕纸纹，旧书氛围',
  mode: 'light',
  palette: {
    bg: '#e4d8c0',
    content: '#ece1cb',
    surface: '#f7efdd',
    overlay: '#f6eeda',
    input: '#fffdf4',
    border: 'rgba(93, 74, 50, 0.25)',
    fill: 'rgba(93, 74, 50, 0.05)',
    fillSoft: 'rgba(93, 74, 50, 0.035)',
    text1: '#3d3122',
    text2: '#5d4f3a',
    text3: '#97866a',
    accent: '#a0622d',
    accentHover: '#b47438',
    accentPressed: '#8a5222',
    accentSoft: 'rgba(160, 98, 45, 0.12)',
    accentBorder: 'rgba(160, 98, 45, 0.35)',
    accentText: '#8a5222',
    good: '#4d7c0f',
    warn: '#b45309',
    bad: '#b91c1c',
    editorBg: '#f3ead6',
    editorActive: 'rgba(93, 74, 50, 0.06)',
    coverBg: '#e0d3b8',
    brandGrad: 'linear-gradient(135deg, #a0622d, #c98a3d)',
  },
  texture: [
    paperGlow(),
    'repeating-linear-gradient(0deg, rgba(93, 74, 50, 0.02) 0px, rgba(93, 74, 50, 0.02) 1px, transparent 1px, transparent 5px)',
    grainTexture('93, 74, 50', 0.05),
  ].join(', '),
};

/** 竹林 · 青韵：淡青底 + 竹影纹样 */
const bamboo: ThemeDefinition = {
  id: 'bamboo',
  label: '竹林 · 青韵',
  description: '淡青竹影，清雅文气',
  mode: 'light',
  palette: {
    bg: '#dfe9da',
    content: '#e9f0e5',
    surface: '#f5f9f1',
    overlay: '#f4f8f0',
    input: '#fcfef9',
    border: 'rgba(47, 77, 58, 0.22)',
    fill: 'rgba(47, 77, 58, 0.045)',
    fillSoft: 'rgba(47, 77, 58, 0.03)',
    text1: '#26382c',
    text2: '#475c4d',
    text3: '#7f9083',
    accent: '#3f7d54',
    accentHover: '#4f9166',
    accentPressed: '#336846',
    accentSoft: 'rgba(63, 125, 84, 0.11)',
    accentBorder: 'rgba(63, 125, 84, 0.35)',
    accentText: '#336846',
    good: '#1d7a3e',
    warn: '#b45309',
    bad: '#c22f2f',
    editorBg: '#f2f7ec',
    editorActive: 'rgba(47, 77, 58, 0.05)',
    coverBg: '#dbe7d4',
    brandGrad: 'linear-gradient(135deg, #3f7d54, #6fae83)',
  },
  texture: [bambooTexture(), grainTexture('47, 90, 60', 0.035)].join(', '),
};

/** 墨海 · 黛蓝：深墨蓝 + 渍染，夜间书写 */
const ink: ThemeDefinition = {
  id: 'ink',
  label: '墨海 · 黛蓝',
  description: '深墨蓝渍染，夜间书写',
  mode: 'dark',
  palette: {
    bg: '#12151c',
    content: '#14181f',
    surface: '#1b212c',
    overlay: '#1b2230',
    input: 'rgba(255, 255, 255, 0.07)',
    border: 'rgba(190, 210, 235, 0.1)',
    fill: 'rgba(255, 255, 255, 0.03)',
    fillSoft: 'rgba(255, 255, 255, 0.02)',
    text1: '#dde4ee',
    text2: '#b3bfce',
    text3: '#76839a',
    accent: '#6f9fc8',
    accentHover: '#86b3d8',
    accentPressed: '#5b8ab4',
    accentSoft: 'rgba(111, 159, 200, 0.14)',
    accentBorder: 'rgba(111, 159, 200, 0.38)',
    accentText: '#9cc1e0',
    good: '#63c08c',
    warn: '#d9b96a',
    bad: '#e08585',
    editorBg: '#1d242f',
    editorActive: 'rgba(255, 255, 255, 0.035)',
    coverBg: '#1a202b',
    brandGrad: 'linear-gradient(135deg, #6f9fc8, #9cc1e0)',
  },
  texture: [inkWashTexture(), grainTexture('170, 200, 230', 0.04)].join(', '),
};

export const THEMES: ThemeDefinition[] = [dark, light, sepia, bamboo, ink];

export const DEFAULT_THEME_ID = 'dark';

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}
