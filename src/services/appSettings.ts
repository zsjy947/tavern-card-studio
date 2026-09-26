/** 通用键值设置（settings 表包装）：偏好项持久化 */
import { getStore } from '@/db';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await getStore()).get<{ id: string; value: T }>('settings', key);
  return row === undefined ? fallback : row.value;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await (await getStore()).put('settings', key, { id: key, value });
}

/** 已知设置键 */
export const SETTING_KEYS = {
  /** PNG 导出双写 ccv3 + chara（默认 true） */
  pngDualWrite: 'png_dual_write',
  /** 预览用 {{user}} 默认名 */
  uiUserName: 'ui_user_name',
  /** 界面主题 id（core/theme/themes.ts） */
  uiTheme: 'ui_theme',
  /** 界面字体 id（空串 = 默认字体） */
  uiFont: 'ui_font',
  /** 导出文件夹（桌面端；空串 = Rust 默认 exe 同级 data/exports/） */
  exportDir: 'export_dir',
  /** 导出文件名模板（core/card/exportName.ts；空串 = 默认 {name}_{date}） */
  exportFilenameTemplate: 'export_filename_template',
  /** 转换器最近转换记录（上限 50） */
  recentConversions: 'recent_conversions',
  /** 导入预设组合（上限 10） */
  importPresets: 'import_presets',
  /** 界面语言（i18n 骨架；zh-CN / en-US） */
  uiLanguage: 'ui_language',
} as const;
