// @vitest-environment happy-dom
/**
 * appearance store init 分步容错单测（技术债 D5）：
 * 设置库读取失败 / 字体列表加载失败 / localStorage 脏数据，任一步骤失败不拖垮整体初始化。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// appSettings：偏好读取失败场景可控
const getSettingMock = vi.fn<(key: string, fallback: unknown) => Promise<unknown>>();
vi.mock('@/services/appSettings', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...(args as [string, unknown])),
  setSetting: vi.fn(async () => undefined),
  SETTING_KEYS: { uiTheme: 'ui_theme', uiFont: 'ui_font', uiUserName: 'ui_user_name', pngDualWrite: 'png_dual_write', exportDir: 'export_dir' },
}));

// fontService：列表加载失败可控
const listInstalledMock = vi.fn<() => Promise<unknown>>();
vi.mock('@/services/fontService', () => ({
  listInstalled: () => listInstalledMock(),
  ensureFontLoaded: vi.fn(async () => true),
  verifyFontFile: vi.fn(async () => true),
  removeFont: vi.fn(async () => undefined),
}));

vi.mock('@/db/tauri', () => ({ isTauri: () => false }));

import { THEMES } from '@/core/theme';
import { useAppearance } from './appearance';

describe('appearance init 分步容错', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    getSettingMock.mockReset();
    listInstalledMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('正常路径：ready=true 且默认主题生效', async () => {
    getSettingMock.mockResolvedValue('');
    listInstalledMock.mockResolvedValue([]);
    const appearance = useAppearance();
    await appearance.init();
    expect(appearance.ready).toBe(true);
    expect(appearance.themeId).toBeTruthy();
  });

  it('偏好读取失败（步骤①）不阻塞字体列表与 ready', async () => {
    getSettingMock.mockRejectedValue(new Error('settings down'));
    listInstalledMock.mockResolvedValue([{ id: 'f1', family: 'F', fileName: 'f.ttf', installedAt: new Date().toISOString() }]);
    const appearance = useAppearance();
    await appearance.init();
    expect(appearance.ready).toBe(true);
    expect(appearance.installedFonts).toHaveLength(1);
  });

  it('字体列表加载失败（步骤②）ready 仍为 true，列表为空', async () => {
    getSettingMock.mockResolvedValue('');
    listInstalledMock.mockRejectedValue(new Error('font table down'));
    const appearance = useAppearance();
    await appearance.init();
    expect(appearance.ready).toBe(true);
    expect(appearance.installedFonts).toHaveLength(0);
  });

  it('initSync：localStorage 脏数据不致命，非法主题 id 被忽略', () => {
    localStorage.setItem('tcs_theme', 'not-a-theme');
    localStorage.setItem('tcs_font', 'ghost-font');
    const appearance = useAppearance();
    expect(() => appearance.initSync()).not.toThrow();
    expect(appearance.themeId).not.toBe('not-a-theme');
  });

  it('initSync：合法主题 id 生效', () => {
    const valid = THEMES[1]?.id ?? THEMES[0]!.id;
    localStorage.setItem('tcs_theme', valid);
    const appearance = useAppearance();
    appearance.initSync();
    expect(appearance.themeId).toBe(valid);
  });
});
