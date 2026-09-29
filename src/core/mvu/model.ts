/**
 * MVU 变量系统核心模型：变量组 → 三产物（Zod Schema / initvar YAML / 更新规则）+ 固定模板 + lint 自查 + 快捷预设。
 *
 * 设计借鉴 SillyTavern CardForge（GPL-3.0）的变量设计器思路；其中「变量输出格式」「initvar 结构」等
 * 固定模板文本属于 MagVarUpdate（github.com/MagicalAstrogy/MagVarUpdate）社区教程的公共规范文本，
 * 此处作为社区规范常量维护（注明来源），不复制 CardForge 源码。未复制任何 GPL 代码。
 *
 * 前缀语义：`_` 开头 = 只读（AI 可见不可改，更新规则不列出）；`$` 开头 = 隐藏（AI 不可见，框架处理）。
 * 字段名用 `.` 表达嵌套路径（如 `货币.石质天元`），生成时统一构建嵌套树。
 */
import type { MvuVarField, MvuVarGroup } from '../card/schema';

export type MvuFieldType = MvuVarField['type'];

export const MVU_FIELD_TYPES: { value: MvuFieldType; label: string }[] = [
  { value: 'number', label: '数字' },
  { value: 'string', label: '文本' },
  { value: 'boolean', label: '布尔' },
  { value: 'enum', label: '枚举' },
  { value: 'record', label: '记录' },
  { value: 'array', label: '数组' },
];

/** 拆分注入模式下恒蓝灯的分组名（其余组绿灯按组名触发，省 token） */
export const MVU_ALWAYS_ON_GROUPS = ['世界', '系统', '环境', '主角'];

/** 开场白占位符（状态栏/变量框架前端渲染定位用，不发给 AI） */
export const MVU_PLACEHOLDER = '<StatusPlaceHolderImpl/>';

/** 在场角色追踪的固定变量组（可选开关） */
export const MVU_PRESENT_CHARS_FIELD = '在场角色';

export function newMvuField(overrides: Partial<MvuVarField> = {}): MvuVarField {
  return {
    name: '',
    type: 'string',
    defaultValue: '',
    min: null,
    max: null,
    clamp: false,
    enumValues: '',
    recordFields: '',
    description: '',
    ...overrides,
  };
}

export function newMvuGroup(name: string, fields: MvuVarField[] = []): MvuVarGroup {
  return { name, fields };
}

/* ------------------------------------------------------------------ */
/* 嵌套树：`.` 路径 → 树（Zod / YAML / 更新规则三个生成器共用）          */
/* ------------------------------------------------------------------ */

/** 合法 ECMAScript 标识符（含中文等 Unicode 字母；保留字作对象键在 ES5+ 合法） */
const IDENT_KEY_RE = /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u;

/** 键是否可安全裸写在生成代码里（Zod 对象字面量的属性名） */
export function isSafeObjectKey(k: string): boolean {
  return IDENT_KEY_RE.test(k);
}

/**
 * 生成代码的对象键转义（F16/TCS-R1-02）：合法标识符原样输出，
 * 否则 JSON.stringify 成字符串键——自动处理引号/反斜杠/换行/控制字符，
 * 保证任意用户输入的组名/字段名生成的 Zod 代码可被编译。
 */
export function safeKey(k: string): string {
  return isSafeObjectKey(k) ? k : JSON.stringify(k);
}

interface TreeNode {
  field?: MvuVarField;
  children?: Record<string, TreeNode>;
}

function buildTree(fields: MvuVarField[]): Record<string, TreeNode> {
  const root: Record<string, TreeNode> = {};
  for (const f of fields) {
    if (!f.name) continue;
    const parts = f.name.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]!;
      if (!node[k] || node[k]!.field) node[k] = { children: {} };
      if (!node[k]!.children) node[k]!.children = {};
      node = node[k]!.children!;
    }
    node[parts[parts.length - 1]!] = { field: f };
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* 产物一：Zod Schema 代码                                              */
/* 生成规范（MVU 框架约束）：z.coerce.number()（禁 z.number()）、        */
/* .prefault()（禁 .default()）、钳位用 .transform(_.clamp)（禁 .min/.max）、 */
/* 不用 z.strict/z.passthrough、record 优于 array。                     */
/* ------------------------------------------------------------------ */

export function buildZodCode(groups: MvuVarGroup[], opts: { trackPresentChars?: boolean } = {}): string {
  const usable = groups.filter((g) => g.name);
  if (!usable.length) return '(请先添加变量分组)';
  let code =
    "import { registerMvuSchema } from\n  'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\n\nexport const Schema = z.object({\n";
  for (const group of usable) {
    const named = group.fields.filter((f) => f.name);
    // 整组就是一个无名字段 record → 直接以组名挂 record
    const wholeRecord = named.length === 1 && named[0]!.type === 'record' && !named[0]!.name.includes('.');
    if (wholeRecord) {
      code += `  ${safeKey(group.name)}: ${buildZodType(named[0]!, group.name)},\n`;
    } else {
      code += `  ${safeKey(group.name)}: z.object({\n`;
      code += zodTreeToCode(buildTree(named), 2);
      code += '  }).prefault({}),\n';
    }
  }
  if (opts.trackPresentChars) {
    code += `  ${'在场角色追踪'}: z.object({\n    ${MVU_PRESENT_CHARS_FIELD}: z.string().prefault('')\n  }).prefault({}),\n`;
  }
  code += '});\n\n$(() => {\n  registerMvuSchema(Schema);\n});\n';
  return code;
}

function zodTreeToCode(tree: Record<string, TreeNode>, indent: number): string {
  let code = '';
  const pad = '  '.repeat(indent);
  for (const [k, v] of Object.entries(tree)) {
    if (v.field) code += `${pad}${safeKey(k)}: ${buildZodType(v.field)},\n`;
    else if (v.children) {
      code += `${pad}${safeKey(k)}: z.object({\n${zodTreeToCode(v.children, indent + 1)}${pad}}).prefault({}),\n`;
    }
  }
  return code;
}

function buildZodType(field: MvuVarField, groupName?: string): string {
  switch (field.type) {
    case 'number': {
      let t = 'z.coerce.number()';
      if (field.clamp && (field.min !== null || field.max !== null)) {
        const lo = field.min ?? -999999;
        const hi = field.max ?? 999999;
        t += `.transform(v => _.clamp(v, ${lo}, ${hi}))`;
      }
      // 非数字默认值在酒馆端会生成非法代码：收敛为 0（lint 也会提示）
      const num = Number(field.defaultValue);
      t += `.prefault(${Number.isFinite(num) ? num : 0})`;
      return t;
    }
    case 'boolean':
      return `z.boolean().prefault(${field.defaultValue === 'true' ? 'true' : 'false'})`;
    case 'enum': {
      const vals = field.enumValues
        .split(',')
        .map((v) => `'${escapeCode(v.trim())}'`)
        .filter((v) => v !== "''")
        .join(', ');
      return `z.enum([${vals}]).prefault('${escapeCode(field.defaultValue || '')}')`;
    }
    case 'record': {
      const keyDesc = escapeCode(groupName || field.name || '键名');
      const sub = field.recordFields
        .split(',')
        .map((s) => {
          const parts = s.trim().split(':');
          if (parts.length < 2 || !parts[0]) return '';
          const n = parts[0]!.trim();
          const t = parts[1]!.trim();
          const zt = t === 'number' ? 'z.coerce.number().prefault(0)' : "z.string().prefault('')";
          return `      ${safeKey(n)}: ${zt}`;
        })
        .filter(Boolean)
        .join(',\n');
      if (sub) {
        return `z.record(\n    z.string().describe('${keyDesc}'),\n    z.object({\n${sub}\n    }).prefault({})\n  ).prefault({})`;
      }
      return `z.record(z.string().describe('${keyDesc}'), z.string().prefault('')).prefault({})`;
    }
    case 'array':
      return 'z.array(z.string()).prefault([])';
    default:
      return `z.string().prefault('${escapeCode(field.defaultValue || '')}')`;
  }
}

/** 字符串字面量转义（生成 JS 代码用；同时收敛换行为空格） */
function escapeCode(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ');
}

/* ------------------------------------------------------------------ */
/* 产物二：initvar YAML（[initvar] 条目内容；条目禁用态仍被框架读取）    */
/* ------------------------------------------------------------------ */

export function buildInitVarYaml(groups: MvuVarGroup[], opts: { trackPresentChars?: boolean } = {}): string {
  const usable = groups.filter((g) => g.name);
  if (!usable.length) return '(请添加变量分组)';
  let yaml = '';
  for (const group of usable) {
    yaml += `${group.name}:\n`;
    // 整组只有一个无名 record 字段（如 NPC/背包）：框架按 Zod prefault 自初始化，YAML 只留组头
    const onlyNamelessRecord = group.fields.length === 1 && !group.fields[0]!.name && group.fields[0]!.type === 'record';
    if (onlyNamelessRecord) {
      yaml += '  {}\n';
      continue;
    }
    yaml += yamlTreeToText(buildTree(group.fields.filter((f) => f.name)), 1);
  }
  if (opts.trackPresentChars) yaml += `${'在场角色追踪'}:\n  ${MVU_PRESENT_CHARS_FIELD}: ""\n`;
  return yaml;
}

function yamlValue(field: MvuVarField): string {
  switch (field.type) {
    case 'record':
      return '{}';
    case 'array':
      return '[]';
    case 'number':
      return field.defaultValue || '0';
    case 'boolean':
      return field.defaultValue || 'false';
    default:
      return `"${field.defaultValue || ''}"`;
  }
}

function yamlTreeToText(tree: Record<string, TreeNode>, indent: number): string {
  let yaml = '';
  const pad = '  '.repeat(indent);
  for (const [k, v] of Object.entries(tree)) {
    if (v.field) yaml += `${pad}${k}: ${yamlValue(v.field)}\n`;
    else if (v.children) yaml += `${pad}${k}:\n${yamlTreeToText(v.children, indent + 1)}`;
  }
  return yaml;
}

/* ------------------------------------------------------------------ */
/* 产物三：变量更新规则（[mvu_update]变量更新规则 条目内容）              */
/* 结构：type/range/check；`_` 前缀只读不列；同类路径合并；              */
/* 无 description 的纯 string 多字段合并为逗号列表。                     */
/* ------------------------------------------------------------------ */

export function buildUpdateRuleText(groups: MvuVarGroup[], opts: { trackPresentChars?: boolean } = {}): string {
  const usable = groups.filter((g) => g.name);
  if (!usable.length) return '(请先添加变量)';
  let text = '---\n变量更新规则:\n';
  for (const group of usable) {
    const updatable = group.fields.filter((f) => f.name && !f.name.startsWith('_'));
    if (!updatable.length) continue;
    text += `  ${group.name}:\n`;
    text += ruleTreeToText(buildTree(updatable), 2);
  }
  if (opts.trackPresentChars) {
    text += `  ${'在场角色追踪'}:\n    ${MVU_PRESENT_CHARS_FIELD}:\n      check:\n        - update with comma-separated names of characters currently present in the scene\n`;
  }
  return text;
}

function defaultCheck(field: MvuVarField): string {
  switch (field.type) {
    case 'number':
      return 'update when relevant events cause this value to change, use reasonable delta';
    case 'enum':
      return 'update only when conditions trigger a stage transition';
    case 'record':
      return 'insert when new entries appear, remove when they leave or are consumed';
    case 'boolean':
      return 'toggle when the condition changes';
    default:
      return 'update when this information changes in the narrative';
  }
}

function checkLines(desc: string, pad: string): string {
  const lines = String(desc || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.map((l) => `${pad}    - ${l}\n`).join('');
}

function ruleFieldText(field: MvuVarField, name: string, indent: number): string {
  const pad = '  '.repeat(indent / 2);
  let text = `${pad}${name}:\n`;
  if (field.type === 'number') {
    text += `${pad}  type: number\n`;
    if (field.min !== null || field.max !== null) text += `${pad}  range: ${field.min ?? 0}~${field.max ?? '...'}\n`;
  } else if (field.type === 'enum' && field.enumValues) {
    text += `${pad}  type: ${field.enumValues.split(',').map((v) => `'${v.trim()}'`).join('|')}\n`;
  } else if (field.type === 'record') {
    const sub = field.recordFields
      .split(',')
      .map((s) => {
        const parts = s.trim().split(':');
        return parts.length >= 2 ? `${pad}      ${parts[0]!.trim()}: ${parts[1]!.trim()};` : '';
      })
      .filter(Boolean)
      .join('\n');
    if (sub) text += `${pad}  type: |-\n${pad}    {\n${pad}      [${name}: string]: {\n${sub}\n${pad}      }\n${pad}    }\n`;
  } else if (field.type === 'boolean') {
    text += `${pad}  type: boolean\n`;
  }
  text += `${pad}  check:\n`;
  text += checkLines(field.description || defaultCheck(field), pad);
  return text;
}

function ruleTreeToText(tree: Record<string, TreeNode>, indent: number): string {
  let text = '';
  const pad = '  '.repeat(indent);
  const leaves = Object.entries(tree).filter(([, v]) => v.field).map(([k, v]) => ({ key: k, field: v.field! }));
  const branches = Object.entries(tree).filter(([, v]) => !v.field).map(([k, v]) => ({ key: k, subtree: v.children! }));

  // 无 description 的纯 string：多字段合并为逗号列表
  const plainStrings = leaves.filter(({ field }) => field.type === 'string' && !field.description);
  const others = leaves.filter(({ field }) => !(field.type === 'string' && !field.description));

  if (plainStrings.length > 0) {
    text += `${pad}${plainStrings.map((l) => l.key).join(', ')}:\n`;
    text += `${pad}  check:\n${pad}    - update when this information changes in the narrative\n`;
  }

  // 同 type+check 的非 string 字段合并
  const sameCheck = new Map<string, { key: string; field: MvuVarField }[]>();
  for (const item of others) {
    const k = item.field.type + '|' + (item.field.description || defaultCheck(item.field));
    if (!sameCheck.has(k)) sameCheck.set(k, []);
    sameCheck.get(k)!.push(item);
  }
  for (const group of sameCheck.values()) {
    if (group.length > 1) {
      const f0 = group[0]!.field;
      text += `${pad}${group.map((g) => g.key).join(', ')}:\n`;
      if (f0.type === 'number') text += `${pad}  type: number\n`;
      text += `${pad}  check:\n`;
      text += checkLines(f0.description || defaultCheck(f0), pad);
    } else {
      const g = group[0]!;
      text += ruleFieldText(g.field, g.key, indent * 2);
    }
  }

  for (const { key, subtree } of branches) {
    text += `${pad}${key}:\n`;
    text += ruleTreeToText(subtree, indent + 1);
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* 固定模板文本（MagVarUpdate 教程公共规范文本，原样维护）               */
/* ------------------------------------------------------------------ */

/** [mvu_update]变量输出格式 条目内容 */
export const MVU_OUTPUT_FORMAT_TEXT = `---
变量输出格式:
  rule:
    - you must output the update analysis and the actual update commands at once in the end of the next reply
    - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:
      - replace: replace the value of existing paths
      - delta: update the value of existing number paths by a delta value
      - insert: insert new items into an object or array (using \`-\` as array index intends appending to the end)
      - remove
      - move
    - don't update field names starts with \`_\` as they are readonly, such as \`_变量\`
  format: |-
    <UpdateVariable>
    <Analysis>$(IN CHINESE, no more than 400 words)
    - \${calculate time passed: ...}
    - \${decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes/no}
    - \${analyze every variable based on its corresponding \`check\`, according only to current reply instead of previous plots: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "\${/path/to/variable}", "value": "\${new_value}" },
      { "op": "delta", "path": "\${/path/to/number/variable}", "value": "\${positive_or_negative_delta}" },
      { "op": "insert", "path": "\${/path/to/object/new_key}", "value": "\${new_value}" },
      { "op": "insert", "path": "\${/path/to/array/-}", "value": "\${new_value}" },
      { "op": "remove", "path": "\${/path/to/object/key}" },
      { "op": "remove", "path": "\${/path/to/array/0}" },
      { "op": "move", "from": "\${/path/to/variable}", "to": "\${/path/to/another/path}" },
      ...
    ]
    </JSONPatch>
    </UpdateVariable>`;

/** [mvu_update]变量输出格式强调 条目内容 */
export const MVU_OUTPUT_EMPHASIS_TEXT = `---
变量输出格式强调:
  rule: The following must be inserted to the end of reply, and cannot be omitted
  format: |-
    <UpdateVariable>
    ...
    </UpdateVariable>`;

/** 变量列表 条目内容（不加 [mvu_update] 前缀！两个 AI 都需要看到） */
export const MVU_VARIABLE_LIST_TEXT = `---
<status_current_variables>
{{format_message_variable::stat_data}}
</status_current_variables>`;

/** [initvar] 条目固定标题（条目禁用态仍被 MVU 框架读取，注释须写明「勿开」） */
export const MVU_INITVAR_COMMENT = '[initvar]变量初始化勿开';

/** 拆分注入模式下分组条目标题：`${组名}变量` */
export function mvuGroupEntryComment(groupName: string): string {
  return `${groupName}变量`;
}

/** 拆分注入模式下分组条目内容 */
export function mvuGroupEntryContent(groupName: string): string {
  return `${groupName}:\n  {{format_message_variable::stat_data.${groupName}}}`;
}

/** MVU 顶层脚本（bundle.js 导入 + 6 操作按钮；需酒馆助手扩展） */
export const MVU_BUNDLE_IMPORT =
  "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';";

export const MVU_SCRIPT_BUTTONS: { name: string; visible: boolean }[] = [
  { name: '重新处理变量', visible: true },
  { name: '重新读取初始变量', visible: true },
  { name: '清除旧楼层变量', visible: false },
  { name: '快照楼层', visible: false },
  { name: '重演楼层', visible: false },
  { name: '重试额外模型解析', visible: false },
];

/* ------------------------------------------------------------------ */
/* lint 自查（审查步）                                                  */
/* ------------------------------------------------------------------ */

export function mvuCheckIssues(groups: MvuVarGroup[], zodCode: string): string[] {
  const issues: string[] = [];
  if (zodCode.includes('z.number()') && !zodCode.includes('z.coerce.number()'))
    issues.push('Zod: 应使用 z.coerce.number() 而非 z.number()');
  if (zodCode.includes('.default(')) issues.push('Zod: 应使用 .prefault() 而非 .default()');
  if (zodCode.includes('.strict(') || zodCode.includes('.passthrough(')) issues.push('Zod: z.strict 和 z.passthrough 不存在，请移除');
  if (zodCode.includes('.min(') || zodCode.includes('.max(')) issues.push('Zod: 建议用 .transform(v => _.clamp()) 替代 .min()/.max()');
  for (const g of groups) {
    if (!g.name) {
      issues.push('存在未命名的变量分组');
      continue;
    }
    if (!isSafeObjectKey(g.name)) {
      issues.push(`分组「${g.name}」名称含标识符非法字符（Zod 代码中已按字符串键转义）`);
    }
    const names = g.fields.filter((f) => f.name).map((f) => f.name);
    for (const f of g.fields) {
      if (!f.name) continue;
      if (f.name.split('.').some((p) => p && !isSafeObjectKey(p))) {
        issues.push(`${g.name}.${f.name}: 键含标识符非法字符（Zod 代码中已按字符串键转义）`);
      }
      if (f.type === 'enum' && !f.enumValues.trim()) issues.push(`${g.name}.${f.name}: 枚举类型缺少枚举值`);
      if (f.type === 'number' && f.clamp && f.min === null && f.max === null) issues.push(`${g.name}.${f.name}: 开启了钳位但未设置最小/最大值`);
      if (f.type === 'number' && f.defaultValue && !Number.isFinite(Number(f.defaultValue))) {
        issues.push(`${g.name}.${f.name}: 数字类型默认值「${f.defaultValue}」不是合法数字（已按 0 生成）`);
      }
      // 路径冲突：叶子与分支重叠（如 A 与 A.b 同时存在）会静默丢失一个字段
      for (const other of names) {
        if (other !== f.name && other.startsWith(`${f.name}.`)) {
          issues.push(`${g.name}: 「${f.name}」与「${other}」路径冲突（叶子不能同时是分支）`);
          break;
        }
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* 快捷预设（RPG/修仙/校园/模拟经营/恋爱/生存）                          */
/* ------------------------------------------------------------------ */

export const MVU_PRESETS: Record<string, { label: string; groups: MvuVarGroup[] }> = {
  rpg: {
    label: 'RPG',
    groups: [
      newMvuGroup('世界', [
        newMvuField({ name: '日期' }),
        newMvuField({ name: '时间' }),
        newMvuField({ name: '位置' }),
        newMvuField({ name: '天气' }),
      ]),
      newMvuGroup('主角', [
        newMvuField({ name: 'HP', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: 'MP', type: 'number', defaultValue: '50', min: 0, max: 50, clamp: true }),
        newMvuField({ name: '等级', type: 'number', defaultValue: '1', min: 1, max: 99, clamp: true }),
        newMvuField({ name: '经验', type: 'number', defaultValue: '0', min: 0, max: null, clamp: true }),
        newMvuField({ name: '金币', type: 'number', defaultValue: '500', min: 0, max: null, clamp: true }),
      ]),
      newMvuGroup('NPC', [newMvuField({ type: 'record' })]),
      newMvuGroup('背包', [newMvuField({ type: 'record' })]),
    ],
  },
  xiuxian: {
    label: '修仙',
    groups: [
      newMvuGroup('世界', [newMvuField({ name: '日期' }), newMvuField({ name: '位置' })]),
      newMvuGroup('主角', [
        newMvuField({ name: '修为境界', type: 'enum', defaultValue: '凡人', enumValues: '凡人,练气,筑基,金丹,元婴,化神' }),
        newMvuField({ name: '修炼进度', type: 'number', defaultValue: '0', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '灵力', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '灵石', type: 'number', defaultValue: '100', min: 0, max: null, clamp: true }),
      ]),
      newMvuGroup('NPC', [newMvuField({ type: 'record' })]),
      newMvuGroup('背包', [newMvuField({ type: 'record' })]),
    ],
  },
  school: {
    label: '校园',
    groups: [
      newMvuGroup('系统', [
        newMvuField({ name: '日期' }),
        newMvuField({ name: '时间' }),
        newMvuField({ name: '星期' }),
        newMvuField({ name: '位置' }),
      ]),
      newMvuGroup('主角', [
        newMvuField({ name: '体力', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '心情', type: 'number', defaultValue: '80', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '金钱', type: 'number', defaultValue: '5000', min: 0, max: null, clamp: true }),
      ]),
      newMvuGroup('NPC', [newMvuField({ type: 'record' })]),
    ],
  },
  simulation: {
    label: '模拟经营',
    groups: [
      newMvuGroup('系统', [
        newMvuField({ name: '日期' }),
        newMvuField({ name: '回合数', type: 'number', defaultValue: '1', min: 1, max: null, clamp: false }),
        newMvuField({ name: '行动点', type: 'number', defaultValue: '5', min: 0, max: 10, clamp: true }),
      ]),
      newMvuGroup('资源', [
        newMvuField({ name: '金币', type: 'number', defaultValue: '10000', min: 0, max: null, clamp: true }),
        newMvuField({ name: '声望', type: 'number', defaultValue: '0', min: -100, max: 100, clamp: true }),
        newMvuField({ name: '人口', type: 'number', defaultValue: '10', min: 0, max: null, clamp: true }),
      ]),
    ],
  },
  dating: {
    label: '恋爱',
    groups: [
      newMvuGroup('系统', [newMvuField({ name: '日期' }), newMvuField({ name: '时间' }), newMvuField({ name: '位置' })]),
      newMvuGroup('主角', [
        newMvuField({ name: '魅力', type: 'number', defaultValue: '50', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '金钱', type: 'number', defaultValue: '3000', min: 0, max: null, clamp: true }),
        newMvuField({ name: '体力', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
      ]),
      newMvuGroup('NPC', [newMvuField({ type: 'record' })]),
    ],
  },
  survival: {
    label: '生存',
    groups: [
      newMvuGroup('环境', [
        newMvuField({ name: '天数', type: 'number', defaultValue: '1', min: 1, max: null, clamp: false }),
        newMvuField({ name: '天气' }),
        newMvuField({ name: '温度', type: 'number', defaultValue: '25' }),
        newMvuField({ name: '位置' }),
      ]),
      newMvuGroup('生存', [
        newMvuField({ name: 'HP', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '饥饿', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '口渴', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
        newMvuField({ name: '体力', type: 'number', defaultValue: '100', min: 0, max: 100, clamp: true }),
      ]),
      newMvuGroup('物资', [newMvuField({ type: 'record' })]),
    ],
  },
};
