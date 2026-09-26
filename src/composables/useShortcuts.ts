/**
 * 快捷键体系（ROADMAP P2-4）：表格式注册 + 全局统一捕获层。
 * - 注册表是唯一数据源：设置页只读表格、命令面板提示同源
 * - combo 语法：`Ctrl+Shift+X` / `F2` / `Delete` / `ArrowUp`；`Mod` = Ctrl(macOS 用 Cmd)
 * - 输入框聚焦时：带 Ctrl/Meta 的组合仍生效（如 Ctrl+K），纯按键（F2/Delete/方向键）不触发
 * - 同 scope+combo 重复注册：console.warn 并保留最后一个（开发期可见冲突）
 */
import { readonly, ref } from 'vue';

export type ShortcutScope = 'global' | 'library' | 'editor' | 'beautify' | 'converter';

export interface ShortcutDef {
  id: string;
  combo: string;
  scope: ShortcutScope;
  description: string;
  handler: (e: KeyboardEvent) => void;
}

const registry = new Map<string, ShortcutDef>();
/** 版本号：设置页表格响应式刷新用 */
const version = ref(0);

const EDITABLE_RE = /^(INPUT|TEXTAREA|SELECT)$/;

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return EDITABLE_RE.test(t.tagName) || t.isContentEditable;
}

function normalizeCombo(combo: string): string {
  return combo
    .split('+')
    .map((k) => k.trim())
    .map((k) => (k === 'Mod' ? 'Ctrl' : k.length === 1 ? k.toUpperCase() : k))
    .sort((a, b) => {
      // 修饰键在前，主键在后
      const mod = (k: string) => (['Ctrl', 'Alt', 'Shift'].includes(k) ? 0 : 1);
      return mod(a) - mod(b);
    })
    .join('+');
}

export function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

/** 注册（同 id 覆盖；同 scope+combo 冲突时 warn 并保留最后） */
export function registerShortcut(def: ShortcutDef): void {
  const combo = normalizeCombo(def.combo);
  const key = `${def.scope}:${combo}`;
  const existing = [...registry.values()].find((d) => `${d.scope}:${normalizeCombo(d.combo)}` === key && d.id !== def.id);
  if (existing) console.warn(`[shortcuts] 快捷键冲突：${key} 已被「${existing.id}」注册，「${def.id}」将覆盖它`);
  registry.set(key, { ...def, combo });
  version.value++;
}

export function unregisterShortcut(id: string): void {
  for (const [key, d] of registry) {
    if (d.id === id) registry.delete(key);
  }
  version.value++;
}

/** 设置页只读表格数据（scope→中文标注） */
export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: '全局',
  library: '卡库',
  editor: '编辑器',
  beautify: '美化',
  converter: '转换器',
};

export function listShortcuts(): (ShortcutDef & { comboNormalized: string; scopeLabel: string })[] {
  return [...registry.values()]
    .map((d) => ({ ...d, comboNormalized: normalizeCombo(d.combo), scopeLabel: SCOPE_LABELS[d.scope] }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.comboNormalized.localeCompare(b.combo));
}

export const shortcutVersion = readonly(version);

/** LayoutView 挂一次的统一捕获层 */
export function installShortcutLayer(): () => void {
  const onKeydown = (e: KeyboardEvent) => {
    const combo = eventCombo(e);
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    // 输入场景下放行带修饰键的组合，纯按键直接忽略
    if (isEditableTarget(e.target) && !hasModifier) return;
    // 优先匹配当前页面 scope，回退 global
    const scope = (document.querySelector('[data-shortcut-scope]')?.getAttribute('data-shortcut-scope') as ShortcutScope | null) ?? null;
    const candidates = scope ? [`#${scope}:${combo}`, `#global:${combo}`] : [`#global:${combo}`];
    for (const key of candidates) {
      const def = registry.get(key.slice(1));
      if (def) {
        e.preventDefault();
        def.handler(e);
        return;
      }
    }
  };
  window.addEventListener('keydown', onKeydown);
  return () => window.removeEventListener('keydown', onKeydown);
}
