/**
 * 模板变量引擎：`{{user}}/{{char}}/自定义变量` 替换。
 *
 * 自组装透视器（core/st）起，宏求值统一收敛到 core/st/macro.ts（全项目唯一实现，
 * 支持 pick/roll/setvar 双语法/match 等超集），本模块只保留 TemplateEngine 门面：
 * render 委托 evaluateMacros，行为与历史版本逐字节兼容（缺失 char/user 保留字面量、
 * setvar 顺序敏感、random 注入 rng）。
 */

import { evaluateMacros } from '../st/macro';

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
    const result = evaluateMacros(template, this.scope);
    this.scope.vars = result.vars;
    return result.text;
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
