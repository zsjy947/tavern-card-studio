/**
 * AI 生成状态栏 —— 生成管线核心（借鉴 CardForge 的三步生成法，独立实现）：
 * 1. 变量路径设计：数据盘点 → 结构规划 → 路径设计三步思考法（「不要套模板」原则）
 * 2. HTML 生成：完整参考模板 + 硬约束清单（MVU / 纯文本两模式）
 * 3. 完整性检测 isHtmlComplete（闭合标签 + tab 配对）+ 截断自动续写（尾部 400 字符，最多 3 次）
 * 纯函数模块，AI 调用由 UI / 服务层编排。
 */

/** AI 设计的变量路径（stat_data 之后的完整路径 = group + '.' + field） */
export interface StatusbarVarPath {
  group: string;
  field: string;
  type: 'number' | 'string';
  default: string;
}

export type StatusbarMode = 'mvu' | 'text';

export const SB_STYLES = [
  { key: 'dark', label: '深色科技' },
  { key: 'light', label: '浅色简约' },
  { key: 'pastel', label: '柔和粉彩' },
  { key: 'game', label: '游戏面板' },
] as const;
export type SbStyle = (typeof SB_STYLES)[number]['key'];

export const SB_LAYOUTS = [
  { key: 'tabs', label: '多页签（tab 切换）' },
  { key: 'single', label: '单面板（一屏罗列）' },
  { key: 'compact', label: '紧凑条（横向摘要）' },
  { key: 'cards', label: '卡片网格' },
] as const;
export type SbLayout = (typeof SB_LAYOUTS)[number]['key'];

const STYLE_DESC: Record<SbStyle, string> = {
  dark: '深色科技风（深底亮字、霓虹点缀）',
  light: '浅色简约风（素底深字、细边框）',
  pastel: '柔和粉彩风（低饱和圆角卡片）',
  game: '游戏面板风（描边、进度条、徽章）',
};

const LAYOUT_DESC: Record<SbLayout, string> = {
  tabs: '多页签布局：tab-btn 按钮 + tab-content 内容区配对',
  single: '单面板布局：所有分组一屏罗列，分区标题',
  compact: '紧凑条布局：横向一行摘要 + 悬浮展开细节',
  cards: '卡片网格布局：每个分组一张卡片，网格排列',
};

/* ------------------------------------------------------------------ */
/* 第一步：变量路径设计 prompt                                          */
/* ------------------------------------------------------------------ */

export function buildVarListPrompt(cardContext: string, extraRequirement?: string): string {
  return `你是角色卡变量系统设计师。请为这张角色卡设计状态栏需要显示的变量路径。

【角色卡信息】
${cardContext}

${extraRequirement?.trim() ? `【用户需求】\n${extraRequirement.trim()}\n\n` : ''}【设计流程 — 按此顺序思考】

第一步 数据盘点：通读角色卡全部内容，识别「会随剧情变化的动态数据」。
- 这张卡强调了什么独特系统？（修炼体系？经济系统？好感度机制？任务系统？装备系统？）
- 有哪些角色需要追踪状态？（主角、固定 NPC、动态生成的 NPC？）
- 世界状态中有什么需要记录？（时间、地点、天气、事件？）
- 不要套模板：校园卡不需要 HP/MP，修仙卡的境界和灵根比 HP 重要。

第二步 结构规划：把盘点出的数据组织成分组，考虑哪些适合分页 / 分 tab 显示。

第三步 路径设计：为每个变量确定 group（分组名）与 field（字段名）。
- group 是顶层分组（如：主角、伙伴1、NPC1、世界）
- field 是组内字段，嵌套用点分隔（如：货币.石质天元、装备.头部）
- group + field 组合即 stat_data. 之后的完整路径

【输出格式】
只输出 JSON 数组：
[{"group":"主角","field":"名称","type":"string","default":""},
 {"group":"主角","field":"货币.石质天元","type":"number","default":"0"}]

type 仅 number | string。只输出 JSON，不要任何说明文字。`;
}

/* ------------------------------------------------------------------ */
/* 第二步：HTML 生成 prompt（MVU / 纯文本两模式）                       */
/* ------------------------------------------------------------------ */

export function buildHtmlPrompt(
  cardContext: string,
  varList: StatusbarVarPath[],
  style: SbStyle,
  layout: SbLayout,
  extraRequirement?: string,
): string {
  const getLines = varList
    .map((v) => {
      const path = `stat_data.${v.group}.${v.field}`;
      const def = v.type === 'number' ? v.default || '0' : `'${v.default || '--'}'`;
      const id = varElementId(v);
      return `      $("#${id}").text(_.get(all_variables, '${path}', ${def}));`;
    })
    .join('\n');

  return `根据以下变量路径，生成前端状态栏 HTML 代码。

【角色卡信息】
${cardContext}

【变量路径清单 — 必须使用且仅使用这些路径】
${JSON.stringify(varList, null, 2)}

【设计要求】
- 视觉风格：${STYLE_DESC[style]}
- 布局：${LAYOUT_DESC[layout]}
${extraRequirement?.trim() ? `- 用户需求：${extraRequirement.trim()}` : ''}

【完整参考模板 — 严格按此结构编写，不可省略任何部分】
\`\`\`html
<!doctype html>
<html lang="zh-CN">
<head>
  <style>
  body {
    margin: 0;
    padding: 0;
  }

  /* 在这里根据用户要求的视觉风格自由设计样式 */
  </style>
  <script type="module">
    function populateCharacterData() {
      const all_variables = getAllVariables();

      /* 用 _.get(all_variables, 'stat_data.路径', 默认值) 读取每个变量 */
      /* 用 $('#id').text(value) 更新每个元素 */
${getLines || '      /* 无变量时留空 */'}
    }

    async function init() {
      await waitGlobalInitialized('Mvu');
      populateCharacterData();

      /* 监听变量更新事件，实现自动刷新 */
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {
        populateCharacterData();
      });

      $("[data-target]").on("click", function () {
        const target = $(this).data("target");
        $("[data-target]").removeClass("active");
        $(this).addClass("active");
        $(".tab-content, [data-tab-content]").removeClass("active");
        $("#" + target).addClass("active");
      });
    }

    $(errorCatched(init));
  </` + `script>
</head>
<body>
  <!-- 在这里根据用户要求的布局设计 HTML 结构 -->
  <!-- 每个需要显示的变量必须有唯一的 id，在 populateCharacterData 中用 $('#id').text(value) 填充 -->
  <!-- 预填值为 0 或 "--" -->
</body>
</html>
\`\`\`

【重要提示】
- 必须根据用户要求的风格自由设计 CSS 样式
- 可以直接使用 jquery/$、lodash/_、toastr，无需额外导入
- 禁止使用 Mvu.watch 等不存在的接口
- <style> 和 <script> 内只用 /* 注释 */，禁止 // 注释；body 内用 <!-- --> 或不写注释，禁止在 body 内写 /* */
- 禁止使用 vh 单位，用 width 和 aspect-ratio 让高度随宽度动态调整；避免 min-height、overflow: auto
- 页面不要用 position: absolute 脱离文档流；整体适配容器宽度，不产生横向滚动条
- 如果样式更适合卡片形状，则不要有背景颜色，除非用户明确要求
- 必须输出完整的 </body></html> 结尾
- 如果使用 tab 切换：按钮必须用 class="tab-btn"，内容区必须用 class="tab-content"，按钮的 data-target="X" 必须等于对应内容 div 的 id="X"；每个 tab 按钮都必须有对应内容 div，禁止只写按钮不写内容
- CSS 尽量简洁复用 class，不要为每个 tab 单独写大段重复样式

用 \`\`\`html 代码块包裹，只输出代码，不要说明文字。`;
}

export function buildTextPrompt(
  cardContext: string,
  style: SbStyle,
  layout: SbLayout,
  extraRequirement?: string,
): string {
  return `生成纯文本模式的状态栏。数据来源是 AI 每次回复末尾输出的 <StatusData> 标签。

【角色卡信息】
${cardContext}

【设计要求】
- 视觉风格：${STYLE_DESC[style]}
- 布局：${LAYOUT_DESC[layout]}
${extraRequirement?.trim() ? `- 用户需求：${extraRequirement.trim()}` : ''}

【完整参考模板 — 严格按此结构编写】
\`\`\`html
<!doctype html>
<html lang="zh-CN">
<head>
  <style>
  body { margin: 0; padding: 0; }
  /* 根据用户要求设计样式 */
  </style>
  <script type="module">
    function parseAndDisplay() {
      const raw = window.__statusRawText || "";
      const lines = raw.trim().split("\\n").filter(Boolean);
      const data = {};
      lines.forEach(l => {
        const i = l.indexOf(":");
        if (i > 0) data[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      });
      if (Object.keys(data).length > 0) {
        for (const [k, v] of Object.entries(data)) {
          const el = document.getElementById("st-" + k);
          if (el) el.textContent = v;
        }
      }
    }
    parseAndDisplay();
  </` + `script>
</head>
<body>
  <div id="st-panel">
    <!-- 每个字段一行，预填值为 "--" -->
  </div>
</body>
</html>
\`\`\`

【重要提示】
- 仅能使用 /* 注释 */，禁止 //
- body 必须 margin:0; padding:0
- 必须输出完整的 </body></html> 结尾

用 \`\`\`html 代码块包裹，只输出代码。`;
}

export const STATUSBAR_SYSTEM_PROMPT = '你是前端状态栏开发专家。严格按要求输出完整 HTML 代码，不要说明文字。注释只用 /* */。';
export const STATUSBAR_CONTINUE_SYSTEM_PROMPT = '你是前端状态栏开发专家。继续输出缺失的 HTML 代码，不要说明文字。注释只用 /* */。';

/** 变量路径 → 状态栏元素 id（populateCharacterData 填充目标） */
export function varElementId(v: StatusbarVarPath): string {
  return `${v.group}-${v.field}`.replace(/\./g, '-').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* 完整性检测 + 续写                                                    */
/* ------------------------------------------------------------------ */

/** 从模型输出中抽取 HTML（```html 代码块优先，回退去围栏） */
export function extractHtml(text: string): string {
  const t = text.trim();
  const m = /```html\s*\n?([\s\S]*?)```/.exec(t);
  if (m?.[1]) return m[1].trim();
  return t.replace(/```[\w]*\s*\n?/g, '').replace(/```/g, '').trim();
}

/** 找出缺失内容 div 的 tab（data-target 有按钮无内容） */
export function findMissingTabs(html: string): string[] {
  const targets: string[] = [];
  const re = /data-target=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) targets.push(m[1]!);
  return targets.filter((t) => !html.includes(`id="${t}"`) && !html.includes(`id='${t}'`));
}

/** HTML 完整性：有 </html> 或 </body> 结尾，且每个 data-target 都有对应内容 div */
export function isHtmlComplete(html: string): boolean {
  if (!html.includes('</html>') && !html.includes('</body>')) return false;
  return findMissingTabs(html).length === 0;
}

/** 续写 prompt：尾部 400 字符上下文 + 缺失 tab 指引 */
export function buildContinuePrompt(html: string, missingTabs: string[]): { system: string; user: string } {
  let base = html;
  if (html.includes('</html>') && missingTabs.length > 0) {
    base = html.replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<\/html>\s*$/, '');
  }
  const tail = base.slice(-400);
  const user =
    missingTabs.length > 0
      ? `以下 HTML 状态栏代码缺少了这些 tab 页面的内容 div：${missingTabs.join('、')}。\n请只输出缺失的 tab content div，从最后一个已有的 div 结束处继续。不要重复已有内容，不要输出 <head> 和 <style>，直接输出缺失的 div，最后以 </div></body></html> 结尾。\n\n已有代码末尾：\n...${tail}`
      : `以下 HTML 代码被截断了，请从断点处继续输出剩余代码，不要重复已有内容。\n\n...${tail}`;
  return { system: STATUSBAR_CONTINUE_SYSTEM_PROMPT, user };
}

/** 拼接续写结果（若剥离过旧结尾则用剥离后的底座拼接） */
export function mergeContinuation(html: string, continuation: string, missingTabs: string[]): string {
  if (html.includes('</html>') && missingTabs.length > 0) {
    const base = html.replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<\/html>\s*$/, '');
    return `${base}\n${continuation}`;
  }
  return `${html}\n${continuation}`;
}

/** 清理 body 内的 CSS 风格注释（body 内的斜杠星注释会显示为可见文字）与多余空行 */
export function cleanHtmlComments(html: string): string {
  const bodyMatch = /(<body[^>]*>)([\s\S]*?)(<\/body>)/i.exec(html);
  if (!bodyMatch) return html;
  const before = html.substring(0, html.indexOf(bodyMatch[0]));
  const after = html.substring(html.indexOf(bodyMatch[0]) + bodyMatch[0].length);
  const bodyContent = bodyMatch[2]!
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n\n');
  return before + bodyMatch[1] + bodyContent + bodyMatch[3] + after;
}

/* ------------------------------------------------------------------ */
/* 应用产物构造（供服务层 / UI 落卡）                                    */
/* ------------------------------------------------------------------ */

/** AI 变量清单 → MVU 变量组（从状态栏反向创建/补全 MVU 套装） */
export function varListToMvuGroups(list: StatusbarVarPath[]): { name: string; fields: { name: string; type: 'number' | 'string'; defaultValue: string; min: null; max: null; clamp: boolean; enumValues: string; recordFields: string; description: string }[] }[] {
  const map = new Map<string, ReturnType<typeof mkField>[]>();
  for (const v of list) {
    const g = v.group || '其他';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(mkField(v));
  }
  return [...map.entries()].map(([name, fields]) => ({ name, fields }));
}

function mkField(v: StatusbarVarPath) {
  return {
    name: v.field || '',
    type: (v.type === 'number' ? 'number' : 'string') as 'number' | 'string',
    defaultValue: String(v.default ?? ''),
    min: null,
    max: null,
    clamp: false,
    enumValues: '',
    recordFields: '',
    description: '',
  };
}

/** 扫描 HTML/JS 中 stat_data. 路径字面量（三方路径校验用） */
export function scanStatDataPaths(html: string): string[] {
  const set = new Set<string>();
  if (!html) return [];
  const re = /stat_data\.([\w一-龥][\w一-龥.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) set.add(m[1]!);
  return [...set];
}

/** 变量组定义 → 路径集合（三方路径校验用；排除 `_` 只读前缀） */
export function varGroupsToPaths(groups: { name: string; fields: { name: string }[] }[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    if (!g.name) continue;
    for (const f of g.fields) {
      if (!f.name || f.name.startsWith('_')) continue;
      set.add(`${g.name}.${f.name}`);
    }
  }
  return [...set];
}

/** 三方路径校验：双向漂移清单 */
export function checkPathDrift(groups: { name: string; fields: { name: string }[] }[], html: string): { onlyInGroups: string[]; onlyInHtml: string[] } {
  const g = new Set(varGroupsToPaths(groups));
  const h = new Set(scanStatDataPaths(html));
  return {
    onlyInGroups: [...g].filter((p) => !h.has(p)),
    onlyInHtml: [...h].filter((p) => !g.has(p)),
  };
}
