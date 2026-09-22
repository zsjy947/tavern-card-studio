/**
 * 美化服务：状态栏模板三件套一键插入（借鉴 piney 皮皮工作台）。
 *
 * 三件套 = ① first_mes 插占位 tag ② 注册正则渲染脚本 ③ 添加世界书规则条目（蓝灯）。
 * 图片遵循项目需求 #6：仅外链（本地文件夹路径或在线链接），不做 base64 嵌图。
 */
import type { AnyCard, BookEntry, RegexScript } from '@/core/card';
import { renderTemplate } from '@/core/template';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';

export interface InsertOptions {
  /** 变量值覆盖（key → value） */
  variables?: Record<string, string>;
  /** 插入位置：开场白末尾（默认）或描述末尾 */
  target?: 'first_mes' | 'description';
  charName?: string;
}

export interface InsertResult {
  card: AnyCard;
  inserted: { tag: boolean; regex: boolean; worldinfo: boolean };
}

/** 渲染完整 HTML 文档片段（html + css + js 内联），变量替换初始值 */
export function renderStatusbarHtml(payload: StatusbarPayload, vars: Record<string, string>, charName = '{{char}}'): string {
  const scope: Record<string, string> = {};
  for (const v of payload.variables) scope[v.key] = vars[v.key] ?? v.initial;
  if (charName && !vars.char_name) scope.char_name = charName;
  const html = renderTemplate(payload.html, { vars: scope, char: charName });
  const css = payload.css;
  const js = payload.js;
  return `<div class="tcs-statusbar">${html}<style>${css}</style><script>${js}</script></div>`;
}

/** 生成配套的正则脚本（占位 tag → 渲染 HTML） */
export function buildStatusbarRegex(payload: StatusbarPayload, vars: Record<string, string>, charName = '{{char}}'): RegexScript {
  const tag = payload.tag;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const html = renderStatusbarHtml(payload, vars, charName)
    // 正则 replaceString 里 $ 有特殊含义，转义为 $$
    .replace(/\$/g, '$$$$')
    // 换行转 \n 字面量（ST replaceString 支持的写法）
    .replace(/\r?\n/g, '\\n');
  return {
    id: `sb-${Date.now().toString(36)}`,
    scriptName: `状态栏渲染：${tag.replace(/[<>]/g, '')}`,
    findRegex: `/${escaped}/g`,
    replaceString: html,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

/** 生成配套的世界书条目（规则说明，蓝灯） */
export function buildStatusbarWorldinfo(payload: StatusbarPayload): BookEntry {
  const varList = payload.variables.map((v) => `${v.key}(${v.label})`).join('、');
  return {
    id: Date.now() % 100000,
    keys: payload.worldinfoEntry.keys,
    secondary_keys: [],
    comment: payload.worldinfoEntry.comment,
    content: `${payload.worldinfoEntry.content}\n\n[状态栏变量] ${varList}\n[占位符] ${payload.tag}`,
    constant: true,
    selective: false,
    insertion_order: 90,
    enabled: true,
    position: 'before_char',
    use_regex: false,
    extensions: { position: 0, exclude_recursion: false, display_index: 900, probability: 100, useProbability: true, depth: 4, selectiveLogic: 0 },
  };
}

/** 一键插入三件套（返回新卡对象，不修改原卡） */
export function insertStatusbar(card: AnyCard, payload: StatusbarPayload, opts: InsertOptions = {}): InsertResult {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  const vars = opts.variables ?? {};
  const charName = opts.charName ?? '{{char}}';
  const target = opts.target ?? 'first_mes';

  // ① 占位 tag
  let insertedTag = false;
  if (!String(data[target] ?? '').includes(payload.tag)) {
    data[target] = `${String(data[target] ?? '')}\n\n${payload.tag}`;
    insertedTag = true;
  }

  // ② 正则脚本（渲染同一 tag 的旧脚本会被替换）
  const ext = (data.extensions ?? {}) as { regex_scripts?: RegexScript[] };
  const scripts = ext.regex_scripts ?? [];
  const regex = buildStatusbarRegex(payload, vars, charName);
  const normalize = (s: string) => s.replace(/\\\//g, '/').replace(/^\/|\/[a-z]*$/g, '');
  const idx = scripts.findIndex((s) => normalize(s.findRegex).includes(payload.tag));
  if (idx >= 0) scripts[idx] = regex;
  else scripts.push(regex);
  ext.regex_scripts = scripts;
  data.extensions = ext;

  // ③ 世界书条目
  let insertedWi = false;
  const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] };
  if (!book.entries.some((e) => e.comment === payload.worldinfoEntry.comment)) {
    book.entries.push(buildStatusbarWorldinfo(payload));
    insertedWi = true;
  }
  data.character_book = book;

  return { card: next, inserted: { tag: insertedTag, regex: true, worldinfo: insertedWi } };
}

/* ---------------- 嵌图（外链模式） ---------------- */

export interface ImageLinkResult {
  kind: 'http' | 'file' | 'data';
  normalized: string;
  warning?: string;
}

/** 图片链接规范化：本地路径 → file:// URL；data URL 给出警告（需求 #6：不采用 base64 嵌图） */
export function normalizeImageLink(input: string): ImageLinkResult {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'http', normalized: trimmed };
  if (/^file:\/\//i.test(trimmed)) return { kind: 'file', normalized: trimmed };
  if (/^data:image\//i.test(trimmed)) {
    return {
      kind: 'data',
      normalized: trimmed,
      warning: '检测到 base64 内嵌图：会显著膨胀卡体积与上下文。项目约定使用外链（本地文件夹或在线图床）',
    };
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed) || /^\//.test(trimmed)) {
    const withSlashes = trimmed.replace(/\\/g, '/');
    return { kind: 'file', normalized: `file:///${withSlashes.replace(/^\/+/, '')}` };
  }
  if (/^[./]/.test(trimmed)) return { kind: 'file', normalized: trimmed };
  return { kind: 'http', normalized: trimmed };
}
