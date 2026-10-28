/**
 * 全局命令面板注册表（优化文档 P0-3）：
 * 视图/组件只注册命令（id/标题/分组/关键字/执行），面板组件统一渲染与模糊搜索。
 * Ctrl+K 唤起。
 *
 * 标题/分组/关键字支持惰性求值（函数形态）：i18n 消息懒加载晚于命令注册，
 * 若在注册时固化字符串，面板会永久显示原始 key（'command.open' 等）；
 * 函数形态在面板每次计算结果时才解析，消息表/语言切换后自动跟随。
 */

export type CommandText = string | (() => string);

export interface CommandItem {
  id: string;
  title: CommandText;
  group: CommandText;
  keywords?: CommandText;
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

/** 解析惰性文案（面板渲染/搜索路径中调用，t() 的响应性随之进入调用方的 computed） */
export function resolveText(t: CommandText): string {
  return typeof t === 'function' ? t() : t;
}

/** 简单模糊匹配：所有 query 字符按顺序出现在 title+group+keywords 中 */
export function fuzzyMatch(query: string, cmd: CommandItem): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${resolveText(cmd.title)} ${resolveText(cmd.group)} ${resolveText(cmd.keywords ?? '')}`.toLowerCase();
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
    .sort((a, b) =>
      resolveText(a.group).localeCompare(resolveText(b.group))
      || resolveText(a.title).localeCompare(resolveText(b.title)),
    );
}
