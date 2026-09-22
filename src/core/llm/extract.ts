/**
 * LLM 输出的鲁棒 JSON 抽取（Markdown 代码块 / 前后缀噪声 / 思考标签剥离）。
 */

/** 剥离思考类标签：<think>…</think>、<reasoning>、<analysis> 等 */
export function stripThinking(text: string): string {
  return text.replace(/<(think|thinking|reasoning|analysis|thought)>[\s\S]*?<\/\1>/gi, '');
}

/**
 * 从模型输出中抽取 JSON：
 * 1. 剥思考标签
 * 2. 优先 ```json …``` / ``` … ``` 代码块
 * 3. 回退第一个 {…} 或 […] 平衡片段
 */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = stripThinking(text).trim();

  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(cleaned);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    try {
      return JSON.parse(inner) as T;
    } catch {
      // 尝试修复常见尾逗号
      try {
        return JSON.parse(inner.replace(/,\s*([}\]])/g, '$1')) as T;
      } catch { /* 继续回退 */ }
    }
  }

  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  const start = firstArr >= 0 && (firstArr < firstObj || firstObj < 0) ? firstArr : firstObj;
  if (start < 0) throw new Error('输出中未找到 JSON 内容');
  const openCh = cleaned[start]!;
  const closeCh = openCh === '{' ? '}' : ']';

  // 平衡扫描（忽略字符串内的括号）
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      if (inStr) escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        return JSON.parse(slice) as T;
      }
    }
  }
  throw new Error('JSON 片段不平衡，无法解析');
}
