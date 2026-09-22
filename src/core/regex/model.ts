/**
 * ST 正则脚本模型 + 应用引擎。
 *
 * - findRegex 支持 ST 特有的 `/pattern/flags` 字面量写法与裸 pattern 两种
 * - trimStrings：替换后剔除的子串
 * - placement：2=AI 输出、1=用户输入、0=slash 命令…（ST regex.js）
 * - 简化模式 = 只暴露 findRegex/replaceString/placement；高级模式 = 全字段
 */

import { regexScriptSchema, type RegexScript } from '../card/schema';

export const REGEX_PLACEMENT = {
  MD_DISPLAY: 0, // 渲染后显示
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const;

export const PLACEMENT_LABELS: Record<number, string> = {
  0: '渲染显示',
  1: '用户输入',
  2: 'AI 输出',
  3: 'Slash 命令',
  5: '世界书',
  6: '推理过程',
};

/** 把 ST 的 `/xxx/g` 或裸 pattern 解析为 RegExp */
export function compileFindRegex(findRegex: string): RegExp {
  const lit = /^\s*\/(.+)\/([a-z]*)\s*$/s.exec(findRegex);
  try {
    if (lit) return new RegExp(lit[1], lit[2] || 'g');
    return new RegExp(findRegex, 'g');
  } catch (e) {
    throw new Error(`正则语法错误：${(e as Error).message}`);
  }
}

export interface ApplyOptions {
  /** 深度过滤（minDepth/maxDepth 需要消息深度，这里由调用方判断后决定是否应用） */
  isEdit?: boolean;
}

/** 将正则脚本应用到一段文本（供预览/测试用） */
export function applyRegexScript(script: RegexScript, text: string, opts: ApplyOptions = {}): string {
  if (script.disabled) return text;
  if (opts.isEdit && !script.runOnEdit) return text;
  let re: RegExp;
  try {
    re = compileFindRegex(script.findRegex);
  } catch {
    return text;
  }
  let out = text.replace(re, expandMacros(script.replaceString));
  for (const t of script.trimStrings) {
    out = out.split(t).join('');
  }
  return out;
}

/** 替换串中的 ST 宏展开（预览用简化版） */
export function expandMacros(s: string): string {
  return s
    .replace(/\{\{user\}\}/gi, 'User')
    .replace(/\{\{char\}\}/gi, 'Char')
    .replace(/\\n/g, '\n');
}

/** 校验脚本配置合法性（诊断用） */
export function validateRegexScript(script: RegexScript): string[] {
  const issues: string[] = [];
  if (!script.scriptName) issues.push('缺少脚本名称');
  if (!script.findRegex) issues.push('缺少查找正则');
  else {
    try {
      compileFindRegex(script.findRegex);
    } catch (e) {
      issues.push((e as Error).message);
    }
  }
  if (script.minDepth != null && script.maxDepth != null && script.minDepth > script.maxDepth) {
    issues.push('minDepth 不能大于 maxDepth');
  }
  if (!script.placement.length) issues.push('未选择生效位置（placement 为空）');
  return issues;
}

/** 新建脚本（生成稳定 id） */
export function newRegexScript(overrides: Partial<RegexScript> = {}): RegexScript {
  const base = regexScriptSchema.parse({
    id: `rx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    scriptName: '新正则脚本',
    findRegex: '',
    ...overrides,
  });
  return base;
}

/** 一次导入/导出的容器（extensions.regex_scripts 的包装） */
export function serializeRegexScripts(scripts: RegexScript[]): RegexScript[] {
  return scripts.map((s) => regexScriptSchema.parse(s));
}
