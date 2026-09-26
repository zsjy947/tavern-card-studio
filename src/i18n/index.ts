/**
 * i18n 骨架（ROADMAP P3-3 / 迭代六 C3）：
 * - vue-i18n@10 composition 模式，locale 懒加载（createI18n 空表 + 切语言动态 import，vite 分 chunk）
 * - 首期只抽通用层（Layout 导航/命令分组/通用组件），视图深层文案渐进迁移
 * - 语言偏好持久化 settings.ui_language；naive-ui locale 跟随（见 App.vue）
 */
import { createI18n } from 'vue-i18n';
import { getSetting, setSetting, SETTING_KEYS } from '@/services/appSettings';

export type UiLanguage = 'zh-CN' | 'en-US';

export const UI_LANGUAGES: { value: UiLanguage; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

const LS_LANG = 'tcs_language';

/** 同步初值：localStorage 快路径（SSR/测试无 localStorage 时回退默认） */
function initialLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved === 'en-US') return 'en-US';
  } catch { /* 隐私模式等 */ }
  return 'zh-CN';
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLanguage(),
  fallbackLocale: 'zh-CN',
  missingWarn: false,
  fallbackWarn: false,
  // 空表：消息经 loadLocale 异步填充
  messages: {},
});

const loaded = new Set<string>();

/** 动态 import locale（独立 chunk，不进首屏 bundle） */
export async function loadLocale(lang: UiLanguage): Promise<void> {
  if (loaded.has(lang)) return;
  const messages = await (lang === 'en-US'
    ? import('@/locales/en-US.json')
    : import('@/locales/zh-CN.json'));
  i18n.global.setLocaleMessage(lang, messages.default);
  loaded.add(lang);
}

/** 切换语言：懒加载 + 应用 + 持久化（localStorage 快路径 + settings 跨端迁移） */
export async function switchLanguage(lang: UiLanguage): Promise<void> {
  await loadLocale(lang);
  i18n.global.locale.value = lang;
  try {
    localStorage.setItem(LS_LANG, lang);
  } catch { /* 忽略 */ }
  await setSetting(SETTING_KEYS.uiLanguage, lang).catch(() => undefined);
}

/** 启动校准：localStorage 有值直接用；否则读 settings（跨机器迁移），同步阶段已渲染中文不受影响 */
export async function initI18n(): Promise<UiLanguage> {
  const current = i18n.global.locale.value as UiLanguage;
  try {
    const stored = await getSetting<UiLanguage>(SETTING_KEYS.uiLanguage, current);
    if (stored === 'en-US' || stored === 'zh-CN') {
      if (stored !== current) await switchLanguage(stored);
      else await loadLocale(stored);
      return stored;
    }
  } catch { /* 设置库不可用：保持现状 */ }
  await loadLocale(current);
  return current;
}
