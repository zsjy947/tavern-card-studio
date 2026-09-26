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
    // 与卡内既有条目 id 空间协调，避免 Date.now() 撞 id
    wi.id = book.entries.reduce((mx, e) => Math.max(mx, Number(e.id ?? -1)), -1) + 1;
    (wi.extensions as Record<string, unknown>).tcsStatusbarPayload = payload;
    book.entries.push(wi);
    insertedWi = true;
  }
  data.character_book = book;

  return { card: next, inserted: { tag: insertedTag, regex: true, worldinfo: insertedWi } };
}

/* ---------------- AI 生成状态栏：应用产物（迭代五 E3） ---------------- */

export interface AiStatusbarArtifacts {
  regexes: RegexScript[];
  entries: BookEntry[];
  /** 需要确保开场白末尾的占位符（MVU 模式为 <StatusPlaceHolderImpl/>；纯文本模式无需占位符） */
  placeholder?: string;
}

/**
 * MVU 模式：状态栏 HTML 以 ```html 围栏作为 <StatusPlaceHolderImpl/> 的渲染正则（markdownOnly），
 * 配套占位符不发送正则由 MVU 套装提供（若卡内没有 MVU 套装，由调用方先注入）。
 */
export function buildMvuStatusbarArtifacts(html: string): AiStatusbarArtifacts {
  const fenced = `\`\`\`html\n${html}\n\`\`\``.replace(/\$/g, '$$$$').replace(/\r?\n/g, '\\n');
  return {
    regexes: [
      {
        id: `sb-ai-${Date.now().toString(36)}`,
        scriptName: '[美化]状态栏渲染',
        findRegex: '/<StatusPlaceHolderImpl\\s*\\/>/g',
        replaceString: fenced,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      },
    ],
    entries: [],
    placeholder: '<StatusPlaceHolderImpl/>',
  };
}

/**
 * 纯文本模式（无 MVU 备选）：AI 每次回复末尾输出 <StatusData>字段:值</StatusData>，
 * 渲染正则把该块替换为「HTML + 注入 window.__statusRawText 解析脚本」；
 * 配套 promptOnly + minDepth=6 的「对AI隐藏状态数据」正则；
 * 加一条蓝灯「状态数据输出指令」条目（position=4/depth=0/order=200 同 MVU 条目配置）。
 */
export function buildTextStatusbarArtifacts(html: string): AiStatusbarArtifacts {
  const injected = html.replace(
    /<\/body>/i,
    '<script type="module">window.__statusRawText=`$1`;<\/script>\n</body>',
  );
  const fenced = `\`\`\`html\n${injected}\n\`\`\``.replace(/\$/g, '$$$$').replace(/\r?\n/g, '\\n');
  return {
    regexes: [
      {
        id: `sb-ai-text-${Date.now().toString(36)}`,
        scriptName: '状态栏',
        findRegex: '/<StatusData>([\\s\\S]*?)<\\/StatusData>/gm',
        replaceString: fenced,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      },
      {
        id: `sb-ai-text-hide-${Date.now().toString(36)}`,
        scriptName: '对AI隐藏状态数据',
        findRegex: '/<StatusData>[\\s\\S]*?<\\/StatusData>/gm',
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: 6,
        maxDepth: null,
      },
    ],
    entries: [
      {
        id: Date.now() % 100000,
        keys: [],
        secondary_keys: [],
        comment: '状态数据输出指令',
        content:
          '状态数据输出规则:\n  - 每次回复结束后，必须在末尾追加 <StatusData> 块\n  - 格式为每行一个「字段名:值」，冒号后紧跟值\n  - <StatusData> 块不出现在正文中\n\n输出格式示例:\n  <StatusData>\n  位置:某个地方\n  状态:正常\n  </StatusData>',
        constant: true,
        selective: false,
        insertion_order: 200,
        enabled: true,
        position: 'before_char',
        use_regex: false,
        extensions: { position: 4, depth: 0, prevent_recursion: true, exclude_recursion: true, probability: 100, useProbability: true },
      },
    ],
  };
}

/** 把 AI 状态栏产物写进卡（幂等：按脚本名替换已有），返回新卡不改原卡 */
export function applyAiStatusbarArtifacts(card: AnyCard, artifacts: AiStatusbarArtifacts): AnyCard {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  const ext = (data.extensions ?? {}) as { regex_scripts?: RegexScript[] };
  const scripts = ext.regex_scripts ?? [];
  for (const regex of artifacts.regexes) {
    const idx = scripts.findIndex((s) => s.scriptName === regex.scriptName);
    if (idx >= 0) scripts[idx] = regex;
    else scripts.push(regex);
  }
  ext.regex_scripts = scripts;
  data.extensions = ext;

  if (artifacts.entries.length) {
    const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] };
    for (const entry of artifacts.entries) {
      const idx = book.entries.findIndex((e) => e.comment === entry.comment);
      if (idx >= 0) book.entries[idx] = entry;
      else {
        entry.id = book.entries.reduce((mx, e) => Math.max(mx, Number(e.id ?? -1)), -1) + 1;
        book.entries.push(entry);
      }
    }
    data.character_book = book;
  }

  const ph = artifacts.placeholder;
  if (ph) {
    if (typeof data.first_mes === 'string' && !data.first_mes.includes('StatusPlaceHolderImpl')) {
      data.first_mes = `${data.first_mes}\n${ph}`;
    }
    if (Array.isArray(data.alternate_greetings)) {
      data.alternate_greetings = (data.alternate_greetings as string[]).map((g) =>
        g.includes('StatusPlaceHolderImpl') ? g : `${g}\n${ph}`,
      );
    }
  }
  return next;
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
