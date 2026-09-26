/**
 * CSS 规则块定位（ROADMAP P2-2「元素点选定向改」父页侧）：
 * 在 CSS 文本中扫描 `selector{body}` 规则块区间，把点选得到的选择器
 * 归一化反查到源码位置（供编辑器滚动高亮）；查不到时降级为「末尾追加覆盖规则」建议。
 * 纯函数，可单测。选择器归一化：大小写/空白折叠/`:hover` 等伪类剥离比较。
 */

export interface CssRuleBlock {
  /** 原文选择器（trim 后） */
  selector: string;
  /** 规则块在原文中的起止（start 含选择器，end 含 `}`） */
  start: number;
  end: number;
  body: string;
}

/** 扫描 CSS 文本中的规则块（栈式处理 @media 等嵌套；跳过注释与字符串） */
export function parseCssRules(css: string): CssRuleBlock[] {
  const blocks: CssRuleBlock[] = [];
  const stack: { selStart: number; braceIdx: number; bodyStart: number }[] = [];
  let boundary = 0; // 当前规则选择器的起点（上一个 } 或 { 之后）
  let inComment = false;
  let inString: string | null = null;

  const pushBlock = (selStart: number, braceIdx: number, bodyStart: number, bodyEnd: number, blockEnd: number) => {
    // 选择器 = 前一边界到 `{` 之间的文本；剥掉其中混入的注释
    const selector = css
      .slice(selStart, braceIdx)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .trim();
    if (!selector) return;
    blocks.push({ selector, start: selStart, end: blockEnd, body: css.slice(bodyStart, bodyEnd) });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    const next = css[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      stack.push({ selStart: boundary, braceIdx: i, bodyStart: i + 1 });
      boundary = i + 1;
      continue;
    }
    if (ch === '}') {
      const f = stack.pop();
      if (f) pushBlock(f.selStart, f.braceIdx, f.bodyStart, i, i + 1);
      boundary = i + 1;
    }
  }
  return blocks;
}

/** 选择器归一化：剥离伪类/伪元素、小写化、折叠空白与组合符周围空格、去除 nth 空格 */
export function normalizeSelector(sel: string): string {
  return sel
    .trim()
    .toLowerCase()
    .replace(/::?(hover|focus|active|visited|before|after|first-child|last-child|nth-of-type\(\s*\d+\s*\)|nth-child\(\s*\d+\s*\))/g, '')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LocateResult {
  /** 命中的规则块（按归一化后选择器匹配；同一选择器多条时返回最后一条——后写的生效） */
  block: CssRuleBlock | null;
  /** 所有命中（含 media 内重复） */
  matches: CssRuleBlock[];
  /** 未命中时的追加覆盖规则建议 */
  suggestion: string | null;
}

/** 定位：命中返回规则块区间；未命中返回「末尾追加覆盖规则」建议而非报错 */
export function locateRule(css: string, selector: string): LocateResult {
  const target = normalizeSelector(selector);
  if (!target) return { block: null, matches: [], suggestion: null };
  const matches = parseCssRules(css).filter((b) => normalizeSelector(b.selector) === target);
  if (matches.length) return { block: matches[matches.length - 1]!, matches, suggestion: null };
  return {
    block: null,
    matches: [],
    suggestion: `\n/* 点选追加的覆盖规则（原样式中未找到 ${selector} 的规则块） */\n${selector} {\n  \n}`,
  };
}
