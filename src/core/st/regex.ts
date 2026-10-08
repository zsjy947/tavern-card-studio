/**
 * 消息级正则管线——ST regex 引擎"组装侧"的语义实现。
 *
 * 与 core/regex/model.ts 的分工：model.ts 提供单脚本应用原语与语法校验
 * （编辑器测试台用，isEdit 简化模型，本模块不改动它）；本模块补齐消息级语义：
 * - placement 过滤（文本所处的位置必须命中脚本的 placement 列表）
 * - minDepth/maxDepth 深度过滤（距对话末端楼层数，末条 = 0）
 * - promptOnly / markdownOnly 双通路：'prompt' = 发进提示词的文本，
 *   'display' = 渲染显示的文本；两者都不标的脚本两条通路都生效
 * - {{match}} → 整段匹配文本（转为 JS 原生 $& 后走字符串替换，$1 等捕获组语义保留）
 * - substituteRegex：1 = findRegex 内展开宏；2 = replaceString 内也展开宏
 *
 * 已知边界（写进 ARCHITECTURE 明确不支持清单）：宏展开写入的变量不回写对话状态
 * （replaceString 中的 setvar 极罕见）；runOnEdit 仅编辑器测试台语义，不参与组装。
 * 近似：字面量写法带显式非 g 标志（如 /x/i）时仅替换首个匹配（JS replace 原生
 * 语义），无标志时自动补 g 全量替换；真机行为待黄金样本校准。
 */

import { compileFindRegex } from '../regex/model';
import { type RegexScript } from '../card/schema';
import { evaluateMacros, type MacroContext } from './macro';

export type RegexPath = 'prompt' | 'display';

export interface RegexTraceItem {
  scriptName: string;
  applied: boolean;
  skipReason?: string;
  changed: boolean;
}

export interface RegexPipelineOptions {
  /** 本文本所在位置：REGEX_PLACEMENT 值（1=用户输入 / 2=AI 输出 / 0=渲染显示） */
  placement: number;
  /** 距对话末端深度（minDepth/maxDepth 过滤用）；缺省不做深度过滤 */
  depthFromEnd?: number;
  path: RegexPath;
  macroCtx: MacroContext;
}

export function applyRegexPipeline(
  scripts: RegexScript[],
  text: string,
  opts: RegexPipelineOptions,
): { text: string; traces: RegexTraceItem[]; warnings: string[] } {
  let out = text;
  const traces: RegexTraceItem[] = [];
  const warnings: string[] = [];

  for (const script of scripts) {
    const name = script.scriptName || '(未命名)';
    if (script.disabled) {
      traces.push({ scriptName: name, applied: false, skipReason: '已禁用', changed: false });
      continue;
    }
    if (script.placement.length && !script.placement.includes(opts.placement)) {
      traces.push({ scriptName: name, applied: false, skipReason: '位置不符', changed: false });
      continue;
    }
    if (opts.depthFromEnd != null) {
      if (script.minDepth != null && opts.depthFromEnd < script.minDepth) {
        traces.push({ scriptName: name, applied: false, skipReason: `深度 ${opts.depthFromEnd} < minDepth ${script.minDepth}`, changed: false });
        continue;
      }
      if (script.maxDepth != null && opts.depthFromEnd > script.maxDepth) {
        traces.push({ scriptName: name, applied: false, skipReason: `深度 ${opts.depthFromEnd} > maxDepth ${script.maxDepth}`, changed: false });
        continue;
      }
    }
    if (opts.path === 'display' && script.promptOnly) {
      traces.push({ scriptName: name, applied: false, skipReason: '仅提示词通路', changed: false });
      continue;
    }
    if (opts.path === 'prompt' && script.markdownOnly) {
      traces.push({ scriptName: name, applied: false, skipReason: '仅渲染通路', changed: false });
      continue;
    }

    let findSource = script.findRegex;
    let replace = script.replaceString;
    const subCtx: MacroContext = { ...opts.macroCtx };
    if (script.substituteRegex === 1 || script.substituteRegex === 2) {
      findSource = evaluateMacros(findSource, subCtx).text;
    }
    if (script.substituteRegex === 2) {
      // {{match}} 在替换串里代表逐次匹配，预展开时保留字面量（此处告警无意义，过滤）
      const r = evaluateMacros(replace, subCtx);
      replace = r.text;
      warnings.push(...r.warnings.filter((w) => !w.startsWith('{{match}}')));
    }

    let re: RegExp;
    try {
      re = compileFindRegex(findSource);
    } catch (e) {
      traces.push({ scriptName: name, applied: false, skipReason: `正则语法错误：${(e as Error).message}`, changed: false });
      continue;
    }

    const before = out;
    // {{match}} → $&（JS 原生整段匹配），\n 转真换行；字符串形式替换保留 $1 捕获组语义
    const tpl = replace.replace(/\\n/g, '\n').replace(/\{\{match\}\}/gi, '$$&');
    out = out.replace(re, tpl);
    for (const t of script.trimStrings) out = out.split(t).join('');
    traces.push({ scriptName: name, applied: true, changed: before !== out });
  }

  return { text: out, traces, warnings };
}
