/**
 * 统一 ST 宏求值器——全项目唯一的宏实现。此前三处各自为政：
 * template/variables.ts（最全，已改为委托本模块）、regex/model.ts expandMacros
 * （硬编码 'User'/'Char'，保留不动供旧测试台）、diag/staticChecks 宏白名单（只查不求值）。
 *
 * 支持：{{user}} {{char}} {{random:a,b}} {{pick:a,b}} {{roll:20|2d6|3-7}} {{time}} {{date}}
 *       {{setvar::名::值}} / {{setvar:名=值}}（旧语法）{{getvar::名}} / {{var::名}} {{match}}
 * 行为约定：
 * - 未知宏：保留字面量 + warnings（与 staticChecks 宏白名单哲学一致）
 * - {{user}}/{{char}} 上下文缺失：保留字面量（兼容 TemplateEngine 既有语义）
 * - {{match}} 上下文缺失：保留字面量 + warning
 * - 随机一律经 ctx.rng（缺省 Math.random，与既有 TemplateEngine 一致；组装引擎
 *   永远注入 seeded rng 保证确定性）
 * - 单次线性扫描，setvar 对后续宏立即可见（顺序敏感）
 */

export interface MacroContext {
  char?: string;
  user?: string;
  vars?: Record<string, unknown>;
  rng?: () => number;
  /** 正则替换串上下文中的整段匹配文本（{{match}} 取值） */
  match?: string;
  /** 时间来源（测试注入；缺省 new Date()） */
  now?: Date;
}

export interface MacroEvalResult {
  text: string;
  /** setvar 后的完整变量表（含传入 vars）——调用方可写回 ChatState */
  vars: Record<string, unknown>;
  warnings: string[];
}

const MACRO_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function rollDice(spec: string, rng: () => number): number | null {
  const s = spec.trim();
  let m = /^(\d+)d(\d+)$/i.exec(s);
  if (m) {
    const count = Math.min(64, parseInt(m[1]!, 10));
    const sides = parseInt(m[2]!, 10);
    let sum = 0;
    for (let i = 0; i < count; i++) sum += Math.floor(rng() * sides) + 1;
    return sum;
  }
  m = /^(\d+)-(\d+)$/.exec(s);
  if (m) {
    const lo = parseInt(m[1]!, 10);
    const hi = parseInt(m[2]!, 10);
    if (hi < lo) return null;
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
  m = /^(\d+)$/.exec(s);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (n < 1) return null;
    return Math.floor(rng() * n) + 1;
  }
  return null;
}

export function evaluateMacros(text: string, ctx: MacroContext = {}): MacroEvalResult {
  const vars: Record<string, unknown> = { ...(ctx.vars ?? {}) };
  const warnings: string[] = [];
  const rng = ctx.rng ?? Math.random;
  const now = ctx.now ?? new Date();

  const out = text.replace(MACRO_RE, (whole: string, rawBody: string): string => {
    const body = rawBody.trim();
    const lower = body.toLowerCase();
    if (lower === 'user') return ctx.user ?? whole;
    if (lower === 'char') return ctx.char ?? whole;
    if (lower === 'match') {
      if (ctx.match !== undefined) return ctx.match;
      warnings.push('{{match}} 在非正则替换上下文中无法求值，已保留字面量');
      return whole;
    }
    if (lower === 'time') return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (lower === 'date') return now.toLocaleDateString('zh-CN');
    if (lower.startsWith('setvar')) {
      let name: string | undefined;
      let value = '';
      const double = /^setvar::([^:}]+)::([\s\S]*)$/i.exec(body);
      if (double) {
        name = double[1]!.trim();
        value = double[2]!;
      } else {
        const single = /^setvar:([^=}]+)=([\s\S]*)$/i.exec(body);
        if (single) {
          name = single[1]!.trim();
          value = single[2]!;
        }
      }
      if (name === undefined) {
        warnings.push(`无法解析的宏 {{${body}}}`);
        return whole;
      }
      vars[name] = value;
      return '';
    }
    const getVar = /^(?:getvar|var)::?([^}]+)$/i.exec(body);
    if (getVar) {
      const v = vars[getVar[1]!.trim()];
      return v === undefined || v === null ? '' : String(v);
    }
    const list = /^(?:random|pick):([\s\S]+)$/i.exec(body);
    if (list) {
      const items = list[1]!
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!items.length) return '';
      return items[Math.floor(rng() * items.length)]!;
    }
    if (/^roll:/i.test(body)) {
      const spec = body.slice(body.indexOf(':') + 1);
      const n = rollDice(spec, rng);
      if (n === null) {
        warnings.push(`无法解析的 {{roll:${spec}}}`);
        return whole;
      }
      return String(n);
    }
    warnings.push(`未知宏 {{${body}}}`);
    return whole;
  });

  return { text: out, vars, warnings: [...new Set(warnings)] };
}
