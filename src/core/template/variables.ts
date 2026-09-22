/**
 * 模板变量引擎：`{{user}}/{{char}}/自定义变量` 替换。
 *
 * 语法：
 * - `{{user}}` `{{char}}`（大小写不敏感）— 内置宏
 * - `{{var:名字}}` 或 `{{getvar::名字}}` — 自定义变量（ST 宏风格）
 * - `{{setvar:名字=值}}` — 文本内设置变量（高级玩法）
 * - `{{random:a,b,c}}` — 随机选一（美化模板常用）
 * - `{{time}}` `{{date}}` — 时间宏
 */

export interface VariableScope {
  user?: string;
  char?: string;
  vars?: Record<string, unknown>;
  /** random 的确定性种子（测试用）；缺省用 Math.random */
  rng?: () => number;
}

export class TemplateEngine {
  constructor(private scope: VariableScope = {}) {}

  render(template: string): string {
    if (!template) return '';
    return template
      .replace(/\{\{setvar:([^=}]+)=([^}]*)\}\}/gi, (_m, name: string, value: string) => {
        this.scope.vars = { ...(this.scope.vars ?? {}), [name.trim()]: value };
        return '';
      })
      .replace(/\{\{(user|char)\}\}/gi, (_m, which: string) => {
        const w = which.toLowerCase();
        if (w === 'user') return this.scope.user ?? '{{user}}';
        return this.scope.char ?? '{{char}}';
      })
      .replace(/\{\{(?:var|getvar)::?([^}]+)\}\}/gi, (_m, name: string) => {
        const v = this.scope.vars?.[name.trim()];
        return v === undefined || v === null ? '' : String(v);
      })
      .replace(/\{\{random:([^}]+)\}\}/gi, (_m, list: string) => {
        const items = list.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        if (!items.length) return '';
        const rng = this.scope.rng ?? Math.random;
        return items[Math.floor(rng() * items.length)]!;
      })
      .replace(/\{\{time\}\}/gi, () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      .replace(/\{\{date\}\}/gi, () => new Date().toLocaleDateString('zh-CN'));
  }
}

/** 一次性渲染便捷函数 */
export function renderTemplate(template: string, scope: VariableScope = {}): string {
  return new TemplateEngine(scope).render(template);
}

/** 扫描模板中引用到的自定义变量名（供表单生成） */
export function scanVariables(template: string): string[] {
  const names = new Set<string>();
  const re = /\{\{(?:var|getvar)::?([^}]+)\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) names.add(m[1]!.trim());
  return [...names];
}
