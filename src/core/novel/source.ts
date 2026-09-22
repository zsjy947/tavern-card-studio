/**
 * 小说源解析：txt 章节切分 + epub 解包（JSZip + 轻量 xhtml 正文提取）。
 *
 * 章节头识别（中文网文惯例）：
 * - 第X章 / 第X节 / 第X卷 / 楔子 / 序章 / 尾声 / Chapter N
 */

import JSZip from 'jszip';

export interface Chapter {
  index: number;
  title: string;
  /** 起始行（txt 模式，0 基） */
  startLine: number;
  content: string;
}

const CHAPTER_RE =
  /^\s*(第[一二三四五六七八九十百千万零〇两0-9]+[章回节卷幕折话][^\n]{0,60}|[（(【\[]?(?:楔子|序章|序言|引子|前言|尾声|终章|后记|番外[^\n]{0,20}|Chapter\s+\d+[^\n]{0,60})[）)】\]]?)\s*$/;

export function isChapterHeading(line: string): boolean {
  return CHAPTER_RE.test(line.trim());
}

/** txt 全文 → 章节；识别不出章节头时按长度均分 */
export function splitChapters(text: string, opts: { fallbackChunkChars?: number } = {}): Chapter[] {
  const lines = text.split(/\r?\n/);
  const heads: { line: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l && isChapterHeading(l)) heads.push({ line: i, title: l });
  }

  if (heads.length >= 2) {
    const chapters: Chapter[] = [];
    // 正文起点之前的引言并入第一章或独立「开篇」
    const firstHead = heads[0]!;
    if (firstHead.line > 0 && lines.slice(0, firstHead.line).join('').trim()) {
      chapters.push({ index: 0, title: '开篇', startLine: 0, content: lines.slice(0, firstHead.line).join('\n') });
    }
    heads.forEach((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1]!.line : lines.length;
      chapters.push({ index: chapters.length, title: h.title, startLine: h.line, content: lines.slice(h.line, end).join('\n') });
    });
    return chapters.map((c, i) => ({ ...c, index: i }));
  }

  // 无章节头：按目标字数切块
  const chunk = opts.fallbackChunkChars ?? 20_000;
  const chapters: Chapter[] = [];
  let start = 0;
  let n = 0;
  while (start < text.length) {
    let end = Math.min(start + chunk, text.length);
    if (end < text.length) {
      // 尽量在换行处断开
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + chunk * 0.5) end = nl;
    }
    chapters.push({ index: n++, title: `片段 ${n}`, startLine: 0, content: text.slice(start, end) });
    start = end;
  }
  return chapters;
}

/* ---------------- epub ---------------- */

export interface EpubChapter extends Chapter {
  href: string;
}

export interface ParsedEpub {
  title: string;
  chapters: EpubChapter[];
}

/** 从 xhtml 提取正文（环境无关的轻量实现，兼顾 Node 测试） */
export function extractTextFromXhtml(xhtml: string): string {
  return xhtml
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _lv, inner) => `\n${stripTags(inner)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `\n${stripTags(inner)}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** 解析 epub 字节流：spine 顺序 + xhtml 正文 */
export async function parseEpub(bytes: Uint8Array): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(bytes);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('epub 缺少 META-INF/container.xml（不是标准 epub？）');
  const opfPath = /full-path="([^"]+)"/.exec(containerXml)?.[1];
  if (!opfPath) throw new Error('epub container.xml 中未找到 opf 路径');
  const opf = await zip.file(opfPath)?.async('string');
  if (!opf) throw new Error(`epub 缺少 opf：${opfPath}`);

  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1]?.trim() ?? '';

  // manifest id → href
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\s[^>]*>/g)) {
    const tag = m[0];
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (id && href) manifest.set(id, href);
  }
  // spine 阅读顺序
  const spineIds = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"[^>]*>/g)].map((m) => m[1]!);
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const chapters: EpubChapter[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href || !/\.x?html?$/i.test(href)) continue;
    const path = decodeURIComponent(baseDir + href);
    const file = zip.file(path);
    if (!file) continue;
    const xhtml = await file.async('string');
    const content = extractTextFromXhtml(xhtml);
    if (!content) continue;
    const headMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(xhtml);
    const title2 = headMatch ? stripTags(headMatch[1]!).trim() : '';
    chapters.push({ index: chapters.length, href: path, title: title2 || `第 ${chapters.length + 1} 节`, startLine: 0, content });
  }
  if (!chapters.length) throw new Error('epub 中没有可提取的正文章节');
  return { title: title || '未命名', chapters };
}

/* ---------------- 上下文检索 ---------------- */

/** 命中关键词的段落收集 + 超限等距采样（长小说上下文构建） */
export function collectContext(
  chapters: { title: string; content: string }[],
  keywords: string[],
  opts: { maxChars?: number; perChapterMax?: number } = {},
): { text: string; hits: number } {
  const maxChars = opts.maxChars ?? 120_000;
  const perChapterMax = opts.perChapterMax ?? 4000;
  const paras: { chapterTitle: string; text: string }[] = [];
  let hits = 0;

  for (const ch of chapters) {
    const kws = keywords.filter((k) => k && ch.content.includes(k));
    if (!kws.length) continue;
    // 段落切分
    const paragraphs = ch.content.split(/\n+/).filter((p) => p.trim());
    const picked: string[] = [];
    let size = 0;
    for (const p of paragraphs) {
      if (keywords.some((k) => k && p.includes(k))) {
        picked.push(p);
        hits++;
        size += p.length;
        if (size >= perChapterMax) break;
      }
    }
    if (picked.length) paras.push({ chapterTitle: ch.title, text: picked.join('\n') });
  }

  // 等距采样压缩到 maxChars
  let total = paras.reduce((a, p) => a + p.text.length, 0);
  let pool = paras;
  if (total > maxChars && paras.length > 1) {
    const keep = Math.max(1, Math.floor((paras.length * maxChars) / total));
    const step = paras.length / keep;
    pool = Array.from({ length: keep }, (_, i) => paras[Math.floor(i * step)]!).filter(Boolean);
    total = pool.reduce((a, p) => a + p.text.length, 0);
  }
  const text = pool.map((p) => `【${p.chapterTitle}】\n${p.text}`).join('\n\n').slice(0, maxChars);
  return { text, hits };
}

/** 候选角色名扫描：中文 2-4 字词频 + 边缀折叠（处理贪心分词的子串污染） */
export function scanCharacterNames(text: string, topN = 40): { name: string; count: number }[] {
  const STOP = new Set([
    '他们', '她们', '我们', '自己', '什么', '这个', '那个', '一个', '没有', '就是', '可以', '现在',
    '知道', '起来', '出来', '下去', '时候', '这样', '那样', '怎么', '如果', '但是', '可是', '所以',
    '因为', '或者', '而且', '已经', '应该', '不会', '不能', '不要', '只有', '还有', '这些', '那些',
    '这里', '那里', '哪里', '谁说', '说着', '看着', '想著', '然后', '于是', '接着', '此时', '随后',
    '父亲', '母亲', '哥哥', '姐姐', '弟弟', '妹妹', '老师', '同学', '先生', '小姐', '太太',
    '说了', '想靠', '一下', '一些', '很多', '非常', '直接', '突然', '所有', '的人', '一句', '句话',
    '一句', '他的', '她的', '自己的', '不是', '就是', '就是', '起来', '过去', '出来', '进去',
    '时候', '样子', '地方', '东西', '事情', '问题', '开始', '继续', '结束', '发现', '觉得', '认为',
  ]);

  // 1) 贪心匹配 2-4 字词块
  const direct = new Map<string, number>();
  const re = /[\u4e00-\u9fff]{2,4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0];
    if (STOP.has(w)) continue;
    direct.set(w, (direct.get(w) ?? 0) + 1);
  }

  // 2) 边缀折叠：人名总在词块边缘（「沈舟看着」→「沈舟」；「看着林晚」→「林晚」）
  const edge = new Map<string, number>();
  for (const [w, c] of direct) {
    if (w.length < 3) continue;
    for (const part of [w.slice(0, 2), w.slice(-2)]) {
      if (STOP.has(part)) continue;
      edge.set(part, (edge.get(part) ?? 0) + c);
    }
  }

  // 3) 得分：2 字词 = 直接 + 边缀（含仅边缀出现的名字）；长词被高边缀支持时视为「名+谓语粘连」丢弃
  const score = new Map<string, number>();
  const dropped = new Set<string>();
  for (const [w, c] of direct) {
    if (w.length === 2) {
      if (!STOP.has(w)) score.set(w, c + (edge.get(w) ?? 0));
    } else {
      const support = Math.max(edge.get(w.slice(0, 2)) ?? 0, edge.get(w.slice(-2)) ?? 0);
      if (support >= c * 0.6) dropped.add(w);
      else score.set(w, c);
    }
  }
  for (const [w, c] of edge) {
    if (!score.has(w) && !dropped.has(w)) score.set(w, c);
  }

  return [...score.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((x) => x.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
