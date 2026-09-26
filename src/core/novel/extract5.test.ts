import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTRACT_CONFIG,
  SELF_CHECK_PROMPT,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  chunkNovel,
  emptyExtraction,
  extractionToWorldEntries,
  normalizeExtractionArray,
  type ExtractConfig,
  type NovelExtraction,
} from './extract5';

function novelText(chapters: number): string {
  let out = '';
  for (let i = 1; i <= chapters; i++) {
    out += `第${i}章 试炼之路\n`;
    out += `这是第${i}章的正文内容。`.repeat(30) + '\n\n';
  }
  return out;
}

const charA = {
  name: '沈舟',
  role: 'major',
  first_chapter: '第1章',
  last_chapter: '第10章',
  basic: { 身份: '外门弟子' },
  appearance: '左手旧伤',
  tracks: {
    境界: [{ chapter: '第3章', state: '练气三层', evidence: '原文句' }],
    位置: [{ chapter: '第4章', location: '藏经阁' }],
    物品: [{ chapter: '第2章', action: '获得', item: '青锋剑', source: '宗门赏赐' }],
    关系: [{ target: '林晚', behaviors: [{ chapter: '第10章', behavior: '借钱不要求归还' }], summary: '照顾' }],
    行为模式: [{ stage: '入门初期', range: '第1-10章', dialogues: ['第5章：我不同意'], decisions: '正面硬刚' }],
  },
};

const charB = { name: '林晚', role: 'major', first_chapter: '第1章', last_chapter: '第9章', basic: {}, appearance: '', tracks: { 境界: [], 位置: [], 物品: [], 关系: [], 行为模式: [] } };
const charMinor = { name: '小六', role: 'minor', first_chapter: '第2章', last_chapter: '第3章', basic: {}, appearance: '', tracks: { 境界: [], 位置: [], 物品: [], 关系: [], 行为模式: [] } };

function sampleExtraction(): NovelExtraction {
  return {
    characters: [charA, charB, charMinor] as NovelExtraction['characters'],
    eventlines: [
      {
        name: '外门大比',
        type: '主线',
        cause: { chapter: '第1章', summary: '为入内门' },
        passages: [
          { chapter: '第5章', node: '初赛', key_characters: ['沈舟', '林晚', '小六', '多余'] },
        ],
        result: { chapter: '第9章', summary: '夺魁' },
        follow_up: '内门之路开启',
      },
      { name: '暗线·长老阴谋', type: '暗线', cause: null, passages: [], result: null, follow_up: '' },
    ],
    timeline: [
      { stage_name: '入门初期', chapter_range: '第1-10章', time_markers: [{ chapter: '第2章', raw: '三个月后', annotation: '约3个月' }], summary: '拜师', protagonist_status: '练气三层' },
    ],
    settings: [
      { subtype: '功法', name: '破云剑', level: '玄阶', first_chapter: '第3章', effect: '斩出剑气' },
      { subtype: '世界观常识', name: '等级体系', first_chapter: '', description: '练气→筑基' },
    ],
    item_trajectories: [
      { item_name: '青锋剑', owner: '沈舟', events: [{ chapter: '第2章', action: '获得', source: '赏赐' }, { chapter: '第8章', action: '消耗', destination: '折断' }] },
    ],
  };
}

describe('chunkNovel 章节切片', () => {
  it('≥3 章走章节分组（每片 5 章）', () => {
    const r = chunkNovel(novelText(12), { chunkStrategy: 'auto', chaptersPerChunk: 5 });
    expect(r.strategy).toBe('chapter');
    expect(r.totalChapters).toBe(12);
    expect(r.fallback).toBe(false);
    expect(r.chunks).toHaveLength(3);
    expect(r.chunks[0]!.range).toContain('第1章');
    expect(r.chunks[0]!.range).toContain('第5章');
  });

  it('不足 3 章 auto 回退字数（句号断尾）', () => {
    const r = chunkNovel(novelText(2), { chunkStrategy: 'auto', wordsPerChunk: 300 });
    expect(r.strategy).toBe('words');
    expect(r.fallback).toBe(true);
    expect(r.chunks.length).toBeGreaterThan(1);
    for (const c of r.chunks) expect(/[。！？\n]$/.test(c.text)).toBe(true);
  });

  it('chapter 强制模式与 words 强制模式', () => {
    expect(chunkNovel(novelText(1), { chunkStrategy: 'chapter' }).strategy).toBe('chapter');
    expect(chunkNovel(novelText(5), { chunkStrategy: 'words', wordsPerChunk: 500 }).strategy).toBe('words');
    expect(chunkNovel('   ', {}).chunks).toHaveLength(0);
  });
});

describe('prompt 组装', () => {
  it('system prompt 含铁律 + 主角双模式规则', () => {
    const replace = buildExtractSystemPrompt('character', { ...DEFAULT_EXTRACT_CONFIG, userMode: 'replace', protagonistName: '沈舟' });
    expect(replace).toContain('5 种轨迹');
    expect(replace).toContain('写作铁律');
    expect(replace).toContain('{{user}} 替代小说主角');
    expect(replace).toContain('「沈舟」= {{user}}'.replace(/「/g, '「'));
    const npc = buildExtractSystemPrompt('character', { ...DEFAULT_EXTRACT_CONFIG, userMode: 'npc', protagonistName: '沈舟' });
    expect(npc).toContain('主角作为 NPC');
    expect(buildExtractSystemPrompt('eventline', DEFAULT_EXTRACT_CONFIG)).toContain('四值');
    expect(buildExtractSystemPrompt('item_trajectory', DEFAULT_EXTRACT_CONFIG)).toContain('不存当前持有');
  });

  it('user prompt 带衔接摘要与原文', () => {
    const u = buildExtractUserPrompt('setting', '正文内容', '前情摘要');
    expect(u).toContain('前文衔接摘要');
    expect(u).toContain('正文内容');
  });

  it('自检 prompt 覆盖四项修正', () => {
    expect(SELF_CHECK_PROMPT).toContain('章节号');
    expect(SELF_CHECK_PROMPT).toContain('白描');
    expect(SELF_CHECK_PROMPT).toContain('八股');
  });
});

describe('normalizeExtractionArray 归一化', () => {
  it('枚举收敛：事件线非法类型 → 支线；物品非法 action → 获得', () => {
    const events = normalizeExtractionArray<unknown>([{ name: 'x', type: '人物关系变化线' }], 'eventline');
    expect(events[0]).toMatchObject({ type: '支线' });
    const items = normalizeExtractionArray<unknown>([{ item_name: '剑', events: [{ chapter: '第1章', action: '偷窃' }] }], 'item_trajectory');
    expect((items[0] as { events: { action: string }[] }).events[0]!.action).toBe('获得');
  });

  it('空对象过滤 + 非数组返回空', () => {
    expect(normalizeExtractionArray([{}, null, 'x'], 'character')).toHaveLength(0);
    expect(normalizeExtractionArray('oops', 'setting')).toHaveLength(0);
    expect(normalizeExtractionArray([{ name: 'a', subtype: '奇怪' }], 'setting')[0]).toMatchObject({ subtype: '世界观常识' });
  });
});

describe('extractionToWorldEntries 蓝绿灯自动分配', () => {
  const config: ExtractConfig = { ...DEFAULT_EXTRACT_CONFIG, chapterName: '第一卷' };

  it('单主角卡：重要角色蓝灯 before_char；多主角卡：配角绿灯 after_char', () => {
    // 单主角：只保留沈舟一个 major
    const singleSet: NovelExtraction = { ...sampleExtraction(), characters: [charA, charMinor] as NovelExtraction['characters'] };
    const single = extractionToWorldEntries(singleSet, config);
    const shenzhou = single.find((e) => e.comment.includes('角色·沈舟'))!;
    expect(shenzhou.constant).toBe(true);
    expect(shenzhou.position).toBe('before_char');
    expect(shenzhou.extensions.exclude_recursion).toBe(true);
    expect(shenzhou.extensions.prevent_recursion).toBe(false);
    expect(shenzhou.comment.startsWith('[第一卷] ')).toBe(true);

    // 多主角：沈舟 + 林晚都为 major → 配角绿灯 after_char
    const multiEntries = extractionToWorldEntries(sampleExtraction(), { ...config });
    const a = multiEntries.find((e) => e.comment.includes('角色·沈舟'))!;
    const b = multiEntries.find((e) => e.comment.includes('角色·林晚'))!;
    expect(a.constant).toBe(false);
    expect(a.position).toBe('after_char');
    expect(a.extensions.prevent_recursion).toBe(true);
    expect(b.constant).toBe(false);
  });

  it('次要角色绿灯；主线蓝灯/暗线绿灯带 keys；时间线恒蓝灯；设定物品绿灯', () => {
    const entries = extractionToWorldEntries(sampleExtraction(), config);
    const minor = entries.find((e) => e.comment.includes('次要角色·小六'))!;
    expect(minor.constant).toBe(false);
    expect(minor.keys).toEqual(['小六']);

    const main = entries.find((e) => e.comment.includes('事件线·主线·外门大比'))!;
    expect(main.constant).toBe(true);
    expect(main.keys).toEqual(['外门大比', '沈舟', '林晚', '小六']); // 线名+关键角色前3（多余的被截断）

    const dark = entries.find((e) => e.comment.includes('事件线·暗线'))!;
    expect(dark.constant).toBe(false);

    const tl = entries.find((e) => e.comment.includes('时间线·入门初期'))!;
    expect(tl.constant).toBe(true);
    expect(tl.keys).toEqual([]);

    const set = entries.find((e) => e.comment.includes('设定·功法·破云剑'))!;
    expect(set.constant).toBe(false);
    expect(set.keys).toEqual(['破云剑']);
    expect(set.insertion_order).toBe(100);
    expect(set.extensions.depth).toBe(4);

    const item = entries.find((e) => e.comment.includes('物品·青锋剑'))!;
    expect(item.constant).toBe(false);
    expect(item.content).not.toContain('当前持有');
    expect(item.content).toContain('流转记录');
  });

  it('YAML 内容含章节号锚定与中文引号转义', () => {
    const entries = extractionToWorldEntries(sampleExtraction(), config);
    const shenzhou = entries.find((e) => e.comment.includes('角色·沈舟'))!;
    expect(shenzhou.content).toContain('[第3章] 练气三层');
    expect(shenzhou.content).toContain('境界轨迹:');
    expect(shenzhou.content).toContain('与 林晚');
  });

  it('emptyExtraction 生成空条目集', () => {
    expect(extractionToWorldEntries(emptyExtraction(), DEFAULT_EXTRACT_CONFIG)).toHaveLength(0);
  });
});
