import { describe, expect, it } from 'vitest';
import { blankCard, type AnyCard, type MvuVarGroup } from '@/core/card';
import {
  MVU_OUTPUT_EMPHASIS_TEXT,
  MVU_OUTPUT_FORMAT_TEXT,
  MVU_PLACEHOLDER,
  MVU_PRESETS,
  buildInitVarYaml,
  buildUpdateRuleText,
  buildZodCode,
  mergeMvuVarGroups,
  mvuCheckIssues,
  newMvuField,
  newMvuGroup,
  safeKey,
  splitDriftPath,
} from './model';
import { MVU_DEFAULT_CONFIG, applyMvuToCard, buildMvuSuite, detectExistingMvu, detectMvuConfig, removeExistingMvu } from './suite';

function rpgGroups(): MvuVarGroup[] {
  return JSON.parse(JSON.stringify(MVU_PRESETS.rpg!.groups)) as MvuVarGroup[];
}

function xiuxianGroups(): MvuVarGroup[] {
  const groups = [
    newMvuGroup('主角', [
      newMvuField({ name: '修为境界', type: 'enum', defaultValue: '凡人', enumValues: '凡人,练气,筑基' }),
      newMvuField({ name: '灵石', type: 'number', defaultValue: '100', min: 0, max: null, clamp: true }),
    ]),
    newMvuGroup('货币', [
      newMvuField({ name: '石质天元', type: 'number', defaultValue: '0' }),
      newMvuField({ name: '背包.容量', type: 'number', defaultValue: '20' }),
    ]),
    newMvuGroup('状态', [
      newMvuField({ name: '_秘密', type: 'string', description: 'readonly' }),
      newMvuField({ name: '所在', type: 'string' }),
      newMvuField({ name: '伤势', type: 'string' }),
    ]),
  ];
  return groups;
}

describe('mvu model 三产物生成', () => {
  it('Zod：z.coerce.number + prefault + clamp transform', () => {
    const code = buildZodCode(rpgGroups());
    expect(code).toContain('registerMvuSchema(Schema)');
    expect(code).toContain('z.coerce.number()');
    expect(code).toContain('.transform(v => _.clamp(v, 0, 100))');
    expect(code).toContain('.prefault(');
    expect(code).not.toContain('z.number()');
    expect(code).not.toContain('.default(');
  });

  it('Zod：点路径字段构建嵌套树', () => {
    const code = buildZodCode(xiuxianGroups());
    expect(code).toContain('货币: z.object({');
    expect(code).toContain('石质天元:');
    expect(code).toContain('背包: z.object({');
    expect(code).toContain('容量: z.coerce.number().prefault(20)');
  });

  it('initvar YAML：record={}、嵌套路径、布尔与数字初值', () => {
    const yaml = buildInitVarYaml(xiuxianGroups());
    expect(yaml).toContain('主角:');
    expect(yaml).toContain('修为境界: "凡人"');
    expect(yaml).toContain('灵石: 100');
    expect(yaml).toContain('货币:');
    expect(yaml).toContain('石质天元: 0');
    expect(yaml).toContain('背包:');
    expect(yaml).toContain('容量: 20');
    // record 字段初值为 {}（无名 record 组保留组头自初始化）
    const rpgYaml = buildInitVarYaml(rpgGroups());
    expect(rpgYaml).toContain('NPC:\n  {}');
    expect(rpgYaml).toContain('背包:\n  {}');
  });

  it('更新规则：_ 前缀只读不列、纯 string 合并、enum/range 输出', () => {
    const text = buildUpdateRuleText(xiuxianGroups());
    expect(text).toContain('---\n变量更新规则:');
    expect(text).not.toContain('_秘密');
    // 纯 string 无 description 的字段合并为逗号列表
    expect(text).toContain('所在, 伤势:');
    // enum 列举值
    expect(text).toContain("'凡人'|'练气'|'筑基'");
    // number range
    expect(text).toContain('type: number');
    expect(text).toContain('range: 0~...');
  });

  it('在场角色追踪开关追加固定变量', () => {
    const yaml = buildInitVarYaml(xiuxianGroups(), { trackPresentChars: true });
    expect(yaml).toContain('在场角色追踪:\n  在场角色: ""');
    const rule = buildUpdateRuleText(xiuxianGroups(), { trackPresentChars: true });
    expect(rule).toContain('update with comma-separated names of characters currently present in the scene');
  });

  it('固定模板文本保持社区规范（MagVarUpdate 教程）', () => {
    expect(MVU_OUTPUT_FORMAT_TEXT).toContain('<UpdateVariable>');
    expect(MVU_OUTPUT_FORMAT_TEXT).toContain('<JSONPatch>');
    expect(MVU_OUTPUT_FORMAT_TEXT).toContain('replace');
    expect(MVU_OUTPUT_FORMAT_TEXT).toContain('delta');
    expect(MVU_OUTPUT_FORMAT_TEXT).toContain('move');
    expect(MVU_OUTPUT_EMPHASIS_TEXT).toContain('cannot be omitted');
  });

  it('lint 自查：枚举缺值 / 钳位无边界 / Zod 误用', () => {
    const bad = [
      newMvuGroup('主角', [newMvuField({ name: '境界', type: 'enum' }), newMvuField({ name: '血量', type: 'number', clamp: true })]),
    ];
    const issues = mvuCheckIssues(bad, 'const a = z.number().default(1).min(0).strict()');
    expect(issues.some((i) => i.includes('枚举类型缺少枚举值'))).toBe(true);
    expect(issues.some((i) => i.includes('开启了钳位但未设置最小/最大值'))).toBe(true);
    expect(issues.some((i) => i.includes('z.coerce.number()'))).toBe(true);
    expect(issues.some((i) => i.includes('.prefault()'))).toBe(true);
    expect(issues.some((i) => i.includes('strict'))).toBe(true);
    expect(issues.some((i) => i.includes('clamp'))).toBe(true);
  });
});

describe('mvu suite 13 件套', () => {
  const card: AnyCard = blankCard('测试卡');

  it('整体注入：2 脚本 + 5 条目 + 4 正则 + 占位符，条目配置符合框架约定', () => {
    const suite = buildMvuSuite(card, rpgGroups(), buildZodCode(rpgGroups()), MVU_DEFAULT_CONFIG);
    expect(suite.scripts).toHaveLength(2);
    expect(suite.scripts[0]!.name).toBe('MVU 变量系统');
    expect(suite.scripts[0]!.button?.buttons).toHaveLength(6);
    expect(suite.scripts[0]!.button?.buttons![0]).toEqual({ name: '重新处理变量', visible: true });
    expect(suite.entries).toHaveLength(5);
    expect(suite.regexes).toHaveLength(4);

    const initvar = suite.entries[0]!;
    expect(initvar.comment).toBe('[initvar]变量初始化勿开');
    expect(initvar.enabled).toBe(false);
    expect(initvar.constant).toBe(false);
    for (const e of suite.entries) {
      expect(e.extensions.position).toBe(4);
      expect(e.extensions.depth).toBe(0);
      expect(e.extensions.prevent_recursion).toBe(true);
      expect(e.extensions.exclude_recursion).toBe(true);
      expect(e.insertion_order).toBe(200);
    }
    // 正则链：更新中(渲染) → 完整(渲染) → N楼(promptOnly+minDepth=6) → 占位符(promptOnly)
    expect(suite.regexes[0]!.scriptName).toBe('[美化]变量更新中');
    expect(suite.regexes[0]!.markdownOnly).toBe(true);
    expect(suite.regexes[2]!.promptOnly).toBe(true);
    expect(suite.regexes[2]!.minDepth).toBe(6);
    expect(suite.regexes[3]!.scriptName).toBe('[不发送]界面占位符');
    expect(suite.placeholder).toBe(MVU_PLACEHOLDER);
  });

  it('拆分注入：世界/主角恒蓝灯，NPC 绿灯带 keys，条目数 4+N', () => {
    const suite = buildMvuSuite(card, rpgGroups(), buildZodCode(rpgGroups()), {
      ...MVU_DEFAULT_CONFIG,
      injectMode: 'split',
    });
    // initvar + 更新规则 + 输出格式 + 强调 = 4；世界/主角/NPC/背包 = 4 → 8
    expect(suite.entries).toHaveLength(8);
    const npc = suite.entries.find((e) => e.comment === 'NPC变量')!;
    expect(npc.constant).toBe(false);
    expect(npc.keys).toEqual(['NPC']);
    const world = suite.entries.find((e) => e.comment === '世界变量')!;
    expect(world.constant).toBe(true);
    expect(world.keys).toEqual([]);
  });

  it('幂等：重复注入不叠加，清理后无残留（含占位符与变量组）', () => {
    const groups = rpgGroups();
    const once = applyMvuToCard(card, groups, buildZodCode(groups));
    expect(detectExistingMvu(once)).toBe(true);
    const twice = applyMvuToCard(once, groups, buildZodCode(groups));
    const data = twice.data as Record<string, unknown>;
    const ext = data.extensions as Record<string, unknown>;
    expect(((ext.TavernHelper_scripts as unknown[]) ?? []).length).toBe(2);
    expect(((ext.regex_scripts as unknown[]) ?? []).length).toBe(4);
    expect(((data.character_book as { entries: unknown[] }).entries).length).toBe(5);
    expect(String(data.first_mes).match(/<StatusPlaceHolderImpl\s*\/>/g)).toHaveLength(1);
    expect(ext.tcsMvuVarGroups).toEqual(groups);

    const cleaned = removeExistingMvu(twice);
    expect(detectExistingMvu(cleaned)).toBe(false);
    const cdata = cleaned.data as Record<string, unknown>;
    const cext = cdata.extensions as Record<string, unknown>;
    expect(cext.TavernHelper_scripts ?? []).toHaveLength(0);
    expect(cext.regex_scripts ?? []).toHaveLength(0);
    expect(cext.tcsMvuVarGroups).toBeUndefined();
    expect(String(cdata.first_mes)).not.toContain('StatusPlaceHolderImpl');
  });
});

describe('审查修复回归', () => {
  it('lint 捕获路径冲突与非法数字默认值', () => {
    const groups = [
      newMvuGroup('G', [newMvuField({ name: 'A', type: 'string' }), newMvuField({ name: 'A.b', type: 'number', defaultValue: 'abc' })]),
    ];
    const issues = mvuCheckIssues(groups, buildZodCode(groups));
    expect(issues.some((i) => i.includes('路径冲突'))).toBe(true);
    expect(issues.some((i) => i.includes('不是合法数字'))).toBe(true);
    // 生成端已收敛：非法数字默认值按 0 产出（路径冲突时叶子被分支覆盖，b 字段保留）
    expect(buildZodCode(groups)).toContain('prefault(0)');
  });

  it('Zod 字符串/枚举默认值转义单引号与换行', () => {
    const groups = [
      newMvuGroup('主角', [
        newMvuField({ name: '口头禅', type: 'string', defaultValue: "别信他's 说'的话" }),
        newMvuField({ name: '境界', type: 'enum', defaultValue: '凡\n人', enumValues: '凡人,筑基' }),
      ]),
    ];
    const code = buildZodCode(groups);
    expect(code).toContain("别信他\\'s 说\\'的话");
    expect(code).toContain('凡 人');
  });
});

describe('Zod 键转义（F16/TCS-R1-02）', () => {
  it('safeKey：合法标识符原样（含中文/保留字），特殊字符 JSON 字符串化', () => {
    expect(safeKey('abc')).toBe('abc');
    expect(safeKey('_x1')).toBe('_x1');
    expect(safeKey('石质天元')).toBe('石质天元'); // Unicode 字母是合法标识符
    expect(safeKey('class')).toBe('class'); // 保留字作对象键 ES5+ 合法
    expect(safeKey("a'b")).toBe('"a\'b"');
    expect(safeKey('a"b')).toBe('"a\\"b"');
    expect(safeKey('a\nb')).toBe('"a\\nb"');
    expect(safeKey('a b')).toBe('"a b"');
    expect(safeKey('')).toBe('""');
  });

  it('含引号/换行/中文/保留字键的生成代码可被 new Function 编译', () => {
    const groups = [
      newMvuGroup("反派'组", [
        newMvuField({ name: 'a"b', type: 'string' }),
        newMvuField({ name: '换\n行', type: 'number', defaultValue: '1' }),
        newMvuField({ name: 'class', type: 'string' }), // 保留字
        newMvuField({ name: '中文键.嵌套层', type: 'string' }),
      ]),
      newMvuGroup('空 格', [newMvuField({ name: 'x', type: 'string' })]),
    ];
    const code = buildZodCode(groups);
    // 坏键转义为字符串键
    expect(code).toContain('"反派\'组"');
    expect(code).toContain('"a\\"b"');
    expect(code).toContain('"换\\n行"');
    expect(code).toContain('"空 格"');
    expect(code).toContain('中文键: z.object({');
    expect(code).toContain('嵌套层: z.string()');
    // 整段生成代码语法可编译（剥掉 import/export，未定义标识符仅影响运行不影响解析）
    const js = code.replace(/^import[\s\S]*?;\n\n/, '').replace('export const', 'const');
    expect(() => new Function(js)).not.toThrow();
  });

  it('正常名称输出与旧版一致（不额外加引号）', () => {
    const code = buildZodCode(xiuxianGroups());
    expect(code).toContain('货币: z.object({');
    expect(code).toContain('石质天元:');
    expect(code).toContain('背包: z.object({');
    expect(code).not.toContain('"货币"');
    expect(code).not.toContain('"石质天元"');
  });

  it('lint：键含非法标识符字符时告警', () => {
    const groups = [
      newMvuGroup("坏'组", [newMvuField({ name: '正 常名', type: 'string' }), newMvuField({ name: '好的', type: 'string' })]),
    ];
    const issues = mvuCheckIssues(groups, buildZodCode(groups));
    expect(issues.some((i) => i.includes('分组「坏\'组」名称含标识符非法字符'))).toBe(true);
    expect(issues.some((i) => i.includes('正 常名: 键含标识符非法字符'))).toBe(true);
    // 合法键（中文）不告警
    expect(issues.some((i) => i.includes('好的'))).toBe(false);
  });
});

/* ---------------- mergeMvuVarGroups / splitDriftPath（ROADMAP §二.4 闭环） ---------------- */

describe('mergeMvuVarGroups（AI 变量清单同步合并）', () => {
  it('只补缺失路径，已存在字段保留用户元数据不被 AI 侧覆盖', () => {
    const existing = [newMvuGroup('主角', [newMvuField({ name: '名称', type: 'string', description: '用户的描述' })])];
    const incoming = [
      newMvuGroup('主角', [
        newMvuField({ name: '名称', type: 'number', description: 'AI 的描述' }),
        newMvuField({ name: '等级', type: 'number', defaultValue: '1' }),
      ]),
    ];
    const { groups, addedPaths } = mergeMvuVarGroups(existing, incoming);
    expect(addedPaths).toEqual(['主角.等级']);
    const kept = groups[0]!.fields.find((x) => x.name === '名称')!;
    expect(kept.type).toBe('string');
    expect(kept.description).toBe('用户的描述');
    expect(groups[0]!.fields.find((x) => x.name === '等级')!.defaultValue).toBe('1');
  });

  it('新分组追加到末尾；嵌套字段名整段保留', () => {
    const { groups, addedPaths } = mergeMvuVarGroups([], [newMvuGroup('货币', [newMvuField({ name: '背包.容量', type: 'number' })])]);
    expect(groups.map((g) => g.name)).toEqual(['货币']);
    expect(addedPaths).toEqual(['货币.背包.容量']);
    expect(groups[0]!.fields[0]!.name).toBe('背包.容量');
  });

  it('同名组在 incoming 中重复出现时字段去重', () => {
    const incoming = [
      newMvuGroup('世界', [newMvuField({ name: '时间' })]),
      newMvuGroup('世界', [newMvuField({ name: '时间' }), newMvuField({ name: '地点' })]),
    ];
    const { groups, addedPaths } = mergeMvuVarGroups([], incoming);
    expect(addedPaths.sort()).toEqual(['世界.地点', '世界.时间']);
    expect(groups[0]!.fields.map((f) => f.name).sort()).toEqual(['地点', '时间']);
  });

  it('原数组不被修改（合并产出深拷贝）', () => {
    const existing = [newMvuGroup('主角', [newMvuField({ name: '名称' })])];
    mergeMvuVarGroups(existing, [newMvuGroup('主角', [newMvuField({ name: '新增' })])]);
    expect(existing[0]!.fields).toHaveLength(1);
  });

  it('splitDriftPath：首段为组、其余为嵌套字段；无点路径归「其他」组', () => {
    expect(splitDriftPath('货币.石质天元')).toEqual({ group: '货币', field: '石质天元' });
    expect(splitDriftPath('主角.背包.容量')).toEqual({ group: '主角', field: '背包.容量' });
    expect(splitDriftPath('天气')).toEqual({ group: '其他', field: '天气' });
  });
});

describe('detectMvuConfig（卡内已有套装反推注入配置）', () => {
  it('从正则名反推 keepFloors、条目形态反推 injectMode、更新规则反推在场追踪', () => {
    const groups = [newMvuGroup('世界', [newMvuField({ name: '时间', type: 'string' })])];
    let card = applyMvuToCard(blankCard(), groups, buildZodCode(groups), { injectMode: 'split', keepFloors: 7, trackPresentChars: true });
    expect(detectMvuConfig(card)).toEqual({ injectMode: 'split', keepFloors: 7, trackPresentChars: true });

    card = applyMvuToCard(blankCard(), groups, buildZodCode(groups), { injectMode: 'whole', keepFloors: 3, trackPresentChars: false });
    expect(detectMvuConfig(card)).toEqual({ injectMode: 'whole', keepFloors: 3, trackPresentChars: false });
  });

  it('无套装卡回退默认配置', () => {
    expect(detectMvuConfig(blankCard())).toEqual(MVU_DEFAULT_CONFIG);
  });
});
