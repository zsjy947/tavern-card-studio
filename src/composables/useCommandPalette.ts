/**
 * 全局命令面板注册表（优化文档 P0-3）：
 * 视图/组件只注册命令（id/标题/分组/关键字/执行），面板组件统一渲染与模糊搜索。
 * Ctrl+K 唤起。
 */

export interface CommandItem {
  id: string;
  title: string;
  group: string;
  keywords?: string;
  /** 面板隐藏前执行 */
  run: () => void | Promise<void>;
}

const registry = new Map<string, CommandItem>();

export function registerCommand(cmd: CommandItem): () => void {
  registry.set(cmd.id, cmd);
  return () => registry.delete(cmd.id);
}

export function unregisterCommand(id: string): void {
  registry.delete(id);
}

export function listCommands(): CommandItem[] {
  return [...registry.values()];
}

/** 简单模糊匹配：所有 query 字符按顺序出现在 title+keywords 中 */
export function fuzzyMatch(query: string, cmd: CommandItem): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${cmd.title} ${cmd.group} ${cmd.keywords ?? ''}`.toLowerCase();
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return i >= q.length;
}

export function searchCommands(query: string): CommandItem[] {
  return listCommands()
    .filter((c) => fuzzyMatch(query, c))
    .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}
