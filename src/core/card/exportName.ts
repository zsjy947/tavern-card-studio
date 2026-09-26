/**
 * 导出文件名模板（ROADMAP P1-2）：`{name}`/`{spec}`/`{version}`/`{date}` 占位符渲染。
 * 纯函数可单测；Windows 非法字符的最终兜底由 Rust 侧 safe_export_file_name 二次清洗，
 * 前端只做占位符替换、空名回退与超长截断，不重复实现黑名单。
 */

export interface ExportNameContext {
  name: string;
  /** 卡规格（v1/v2/v3） */
  spec: string;
  /** character_version（可空） */
  version: string;
  /** 日期（默认当天 YYYY-MM-DD） */
  date?: string;
}

export const DEFAULT_EXPORT_TEMPLATE = '{name}_{date}';

/** 合法占位符（供设置页提示） */
export const EXPORT_NAME_PLACEHOLDERS = ['{name}', '{spec}', '{version}', '{date}'] as const;

const MAX_NAME_LEN = 120;

export function todayDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 渲染模板为文件名（不含扩展名，扩展名由调用方拼接）。
 * - 未知占位符原样保留（可见、可自查）
 * - 空模板 → 默认模板；空名 → untitled
 * - 渲染结果整体截断到 160 字符，name 段单独截到 120
 */
export function renderExportFilename(template: string, ctx: ExportNameContext): string {
  const tpl = template?.trim() ? template : DEFAULT_EXPORT_TEMPLATE;
  const name = (ctx.name || '').trim() || 'untitled';
  const out = tpl
    .replaceAll('{name}', name.length > MAX_NAME_LEN ? name.slice(0, MAX_NAME_LEN) : name)
    .replaceAll('{spec}', ctx.spec)
    .replaceAll('{version}', ctx.version || 'none')
    .replaceAll('{date}', ctx.date ?? todayDate())
    .trim();
  // 剔除路径分隔（模板误填），深度目录不在此机制内
  return out.replace(/[/\\]/g, '_').slice(0, 160);
}
