/**
 * 美化服务：状态栏模板三件套一键插入（借鉴 piney 皮皮工作台）。
 *
 * 三件套 = ① first_mes 插占位 tag ② 注册正则渲染脚本 ③ 添加世界书规则条目（蓝灯）。
 * 图片遵循项目需求 #6：仅外链（本地文件夹路径或在线链接），不做 base64 嵌图。
 */
import type { AnyCard, BookEntry, RegexScript } from '@/core/card';
import { renderTemplate } from '@/core/template';
import type { StatusbarPayload, StatusbarVariable } from '@/builtins/statusbarTemplates';

export interface InsertOptions {
  /** 变量值覆盖（key → value） */
  variables?: Record<string, string>;
  /** 插入位置：开场白末尾（默认）或描述末尾 */
  target?: 'first_mes' | 'description';
  charName?: string;
  userName?: string;
}

export interface InsertResult {
  card: AnyCard;
  inserted: { tag: boolean; regex: boolean; worldinfo: boolean };
}

/** 渲染完整 HTML 文档片段（html + css + js 内联），变量替换初始值 */
export function renderStatusbarHtml(payload: StatusbarPayload, vars: Record<string, string>, charName = '{{char}}', userName = '{{user}}'): string {
  const scope: Record<string, string> = {};
  for (const v of payload.variables) scope[v.key] = vars[v.key] ?? v.initial;
  if (charName && !vars.char_name) scope.char_name = charName;
  // 六维模板 js 的属性键表在渲染时按 variables 注入（group==='stat' 的顺序），改名后无需改 js
  const statKeys = payload.variables.filter((v) => v.group === 'stat').map((v) => v.key);
  const html = renderTemplate(payload.html, { vars: scope, char: charName, user: userName });
  const css = payload.css;
  const js = payload.js.replaceAll('__TCS_STAT_KEYS__', JSON.stringify(statKeys));
  return `<div class="tcs-statusbar">${html}<style>${css}</style><script>${js}</script></div>`;
}

/** 生成配套的正则脚本（占位 tag → 渲染 HTML） */
export function buildStatusbarRegex(payload: StatusbarPayload, vars: Record<string, string>, charName = '{{char}}', userName = '{{user}}'): RegexScript {
  const tag = payload.tag;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const html = renderStatusbarHtml(payload, vars, charName, userName)
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

/** 生成配套的世界书条目（规则说明，蓝灯）；变量按 group 分组列出 */
export function buildStatusbarWorldinfo(payload: StatusbarPayload): BookEntry {
  const fmt = (v: StatusbarVariable) => `${v.key}(${v.label})`;
  const groups = [...new Set(payload.variables.map((v) => v.group ?? ''))];
  const varList = groups.every((g) => g === '')
    ? payload.variables.map(fmt).join('、')
    : groups
      .map((g) => {
        const vs = payload.variables.filter((v) => (v.group ?? '') === g).map(fmt).join('、');
        return g ? `${g}：${vs}` : vs;
      })
      .filter(Boolean)
      .join('；');
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

/* ---------------- 变量改名重写器 ---------------- */

const VAR_KEY_RE = /^[a-z_][a-z0-9_]*$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 变量改名：重写 payload 内对该变量的全部引用并同步 variables/previewMock。
 * - {{getvar::old}} → {{getvar::new}}（html / worldinfoEntry.content / css 等全文）
 * - js 对象键名直读（\bold\b 词边界，如 v.stat_str / 'g1_name' 字符串）
 * 返回新 payload（不改原对象）；改名非法或与现有 key 冲突时抛错。
 */
export function renameStatusbarVariable(payload: StatusbarPayload, oldKey: string, newKey: string): StatusbarPayload {
  if (oldKey === newKey) return JSON.parse(JSON.stringify(payload)) as StatusbarPayload;
  if (!VAR_KEY_RE.test(newKey)) throw new Error(`变量 key「${newKey}」非法：需小写字母/下划线开头，仅含小写字母、数字、下划线`);
  if (payload.variables.some((v) => v.key === newKey)) throw new Error(`变量 key「${newKey}」已存在`);
  // 传入的可能是 Vue 响应式代理（structuredClone 会抛错），用 JSON 深拷贝
  const next = JSON.parse(JSON.stringify(payload)) as StatusbarPayload;
  const getVarRe = new RegExp(`\\{\\{getvar::${escapeRe(oldKey)}\\}\\}`, 'g');
  const wordRe = new RegExp(`\\b${escapeRe(oldKey)}\\b`, 'g');
  const rewrite = (s: string) => s.replace(getVarRe, `{{getvar::${newKey}}}`);
  next.html = rewrite(next.html);
  next.css = rewrite(next.css);
  next.js = next.js.replace(wordRe, newKey);
  // 世界书说明：既替换 getvar 占位，也替换散文中的 key 提述（如「金钱(money)」），保证插入的说明同步
  next.worldinfoEntry.content = rewrite(next.worldinfoEntry.content).replace(wordRe, newKey);
  const v = next.variables.find((x) => x.key === oldKey);
  if (!v) throw new Error(`变量「${oldKey}」不存在`);
  v.key = newKey;
  if (Object.prototype.hasOwnProperty.call(next.previewMock, oldKey)) {
    const value = next.previewMock[oldKey]!;
    delete next.previewMock[oldKey];
    next.previewMock[newKey] = value;
  }
  return next;
}

/** 一键插入三件套（返回新卡对象，不修改原卡） */
export function insertStatusbar(card: AnyCard, payload: StatusbarPayload, opts: InsertOptions = {}): InsertResult {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  const vars = opts.variables ?? {};
  const charName = opts.charName ?? '{{char}}';
  const userName = opts.userName ?? '{{user}}';
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
  const regex = buildStatusbarRegex(payload, vars, charName, userName);
  // 元数据：StatusbarPayload 随脚本入库（ST 忽略多余字段），模板中心可反向「沉淀」为状态栏模板
  (regex as unknown as { extensions: { tcsStatusbarPayload: StatusbarPayload } }).extensions = { tcsStatusbarPayload: payload };
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
    const wi = buildStatusbarWorldinfo(payload);
    (wi.extensions as Record<string, unknown>).tcsStatusbarPayload = payload;
    book.entries.push(wi);
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
