/**
 * 外观状态：主题 + 界面字体。
 *
 * - 同步首帧：initSync 直读 localStorage 立即上色，避免主题闪烁；
 *   异步 init 再从设置库校准（备份恢复跨机器时生效）。
 * - naive-ui 基础主题由 mode 决定（dark/light），色板统一走 GlobalThemeOverrides；
 * - 背景纹理与语义色以 CSS 变量铺到 documentElement，视图层只消费变量。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { darkTheme, lightTheme, type GlobalThemeOverrides } from 'naive-ui';
import { cssVarsOf, DEFAULT_THEME_ID, getTheme, THEMES, type ThemeDefinition } from '@/core/theme';
import { getSetting, setSetting, SETTING_KEYS } from '@/services/appSettings';
import { isTauri } from '@/db/tauri';
import { ensureFontLoaded, listInstalled, verifyFontFile, removeFont, type InstalledFontMeta } from '@/services/fontService';

const LS_THEME = 'tcs_theme';
const LS_FONT = 'tcs_font';

/** 主题色板 → naive-ui common 覆写 */
function buildOverrides(t: ThemeDefinition, fontFamily: string): GlobalThemeOverrides {
  const p = t.palette;
  return {
    common: {
      primaryColor: p.accent,
      primaryColorHover: p.accentHover,
      primaryColorPressed: p.accentPressed,
      primaryColorSuppl: p.accentHover,
      borderRadius: '8px',
      fontFamily,
      bodyColor: p.content,
      cardColor: p.surface,
      modalColor: p.surface,
      popoverColor: p.surface,
      inputColor: p.input,
      borderColor: p.border,
      dividerColor: p.border,
      textColorBase: p.text1,
      textColor1: p.text1,
      textColor2: p.text2,
      textColor3: p.text3,
      placeholderColor: p.text3,
    },
  };
}

export const useAppearance = defineStore('appearance', () => {
  const themeId = ref<string>(DEFAULT_THEME_ID);
  const fontId = ref<string>('');
  /** 设置库校准 + 字体注册是否完成（UI 可用它显示加载态） */
  const ready = ref(false);
  const installedFonts = ref<InstalledFontMeta[]>([]);
  /** 字体注册中（大文件首次启用需要解码数秒） */
  const fontPreparing = ref(false);
  /** 已安装但落盘文件缺失/不可读的字体（桌面端），UI 标记并提供重装 */
  const missingFontIds = ref<string[]>([]);

  const theme = computed<ThemeDefinition>(() => getTheme(themeId.value) ?? THEMES[0]!);
  const naiveTheme = computed(() => (theme.value.mode === 'dark' ? darkTheme : lightTheme));
  const fontMeta = computed(() => installedFonts.value.find((f) => f.id === fontId.value));

  const baseFontStack = `'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif`;
  const fontFamily = computed(() =>
    fontMeta.value ? `'${fontMeta.value.family}', ${baseFontStack}` : baseFontStack,
  );

  const themeOverrides = computed<GlobalThemeOverrides>(() => buildOverrides(theme.value, fontFamily.value));
  const statusColors = computed(() => ({
    good: theme.value.palette.good,
    warn: theme.value.palette.warn,
    bad: theme.value.palette.bad,
  }));

  function applyToDom(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cssVarsOf(theme.value))) root.style.setProperty(k, v);
    // naive 会注入 body { font-family: 默认 token }（不吃 overrides），用 --tcs-font-ui 接管
    root.style.setProperty('--tcs-font-ui', fontFamily.value);
    root.style.colorScheme = theme.value.mode;
  }

  /** 同步首帧：localStorage 直读并立即应用（无 DOM 依赖时静默跳过） */
  function initSync(): void {
    try {
      const t = localStorage.getItem(LS_THEME);
      if (t && getTheme(t)) themeId.value = t;
      const f = localStorage.getItem(LS_FONT);
      if (f) fontId.value = f;
    } catch { /* 隐私模式等 localStorage 不可用场景 */ }
    applyToDom();
  }

  /**
   * 异步校准：拆步独立 try/catch——主题偏好、字体列表、字体恢复互不拖垮；
   * 任一步失败不吞掉其余步骤（此前单 try 下一次瞬时失败就让已装列表整场为空）。
   */
  async function init(): Promise<void> {
    initSync();

    // ① 主题与字体偏好（设置库，随备份迁移）
    let prefTheme = '';
    let prefFont = '';
    try {
      const [t, f] = await Promise.all([
        getSetting<string>(SETTING_KEYS.uiTheme, ''),
        getSetting<string>(SETTING_KEYS.uiFont, ''),
      ]);
      prefTheme = t;
      prefFont = f;
    } catch (e) {
      console.error('外观偏好读取失败：', e);
    }

    // ② 已装字体列表（fontService 内部自带一次重试）
    let listLoaded = false;
    try {
      installedFonts.value = await listInstalled();
      listLoaded = true;
    } catch (e) {
      console.error('字体列表加载失败：', e);
    }

    // ③ 主题偏好应用
    if (prefTheme && getTheme(prefTheme)) {
      themeId.value = prefTheme;
      localStorage.setItem(LS_THEME, prefTheme);
    }

    // ④ 字体偏好应用：仅在列表加载成功的前提下校验偏好字体，否则保留现状待下次自愈
    const meta = installedFonts.value.find((x) => x.id === prefFont);
    if (prefFont && meta) {
      fontId.value = prefFont;
      localStorage.setItem(LS_FONT, prefFont);
      try {
        if (isTauri() && !(await verifyFontFile(meta))) {
          markMissing(prefFont, true);
          clearFontPreference();
        } else {
          void prepareFont(prefFont);
        }
      } catch (e) {
        console.error('字体文件校验失败：', e);
      }
    } else if (fontId.value && listLoaded) {
      clearFontPreference();
    }

    // 首次运行把当前值写回设置库（随备份迁移）
    void setSetting(SETTING_KEYS.uiTheme, themeId.value).catch(() => undefined);
    void setSetting(SETTING_KEYS.uiFont, fontId.value).catch(() => undefined);
    ready.value = true;
    applyToDom();
  }

  function markMissing(id: string, missing: boolean): void {
    missingFontIds.value = missing
      ? [...new Set([...missingFontIds.value, id])]
      : missingFontIds.value.filter((x) => x !== id);
  }

  function clearFontPreference(): void {
    fontId.value = '';
    localStorage.removeItem(LS_FONT);
  }

  async function prepareFont(id: string): Promise<boolean> {
    fontPreparing.value = true;
    try {
      const ok = await ensureFontLoaded(id);
      markMissing(id, !ok);
      return ok;
    } finally {
      fontPreparing.value = false;
    }
  }

  async function setTheme(id: string): Promise<void> {
    if (!getTheme(id) || id === themeId.value) return;
    themeId.value = id;
    localStorage.setItem(LS_THEME, id);
    applyToDom();
    await setSetting(SETTING_KEYS.uiTheme, id).catch(() => undefined);
  }

  async function setFont(id: string): Promise<void> {
    if (id === fontId.value) return;
    if (id) {
      const ok = await prepareFont(id);
      if (!ok) throw new Error('字体加载失败，请尝试重新安装');
    }
    fontId.value = id;
    if (id) localStorage.setItem(LS_FONT, id);
    else localStorage.removeItem(LS_FONT);
    applyToDom();
    await setSetting(SETTING_KEYS.uiFont, id).catch(() => undefined);
  }

  /** 安装/卸载字体后刷新列表；当前字体被卸载时回退默认 */
  async function refreshInstalled(): Promise<void> {
    installedFonts.value = await listInstalled();
    const ids = new Set(installedFonts.value.map((x) => x.id));
    missingFontIds.value = missingFontIds.value.filter((x) => ids.has(x));
    if (fontId.value && !ids.has(fontId.value)) {
      fontId.value = '';
      localStorage.removeItem(LS_FONT);
      applyToDom();
      void setSetting(SETTING_KEYS.uiFont, '').catch(() => undefined);
    }
  }

  async function uninstallFont(id: string): Promise<void> {
    await removeFont(id);
    await refreshInstalled();
  }

  return {
    themeId, fontId, ready, installedFonts, fontPreparing, missingFontIds,
    theme, naiveTheme, fontMeta, fontFamily, themeOverrides, statusColors,
    init, initSync, setTheme, setFont, refreshInstalled, uninstallFont,
  };
});
