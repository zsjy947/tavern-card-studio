import { describe, expect, it } from 'vitest';
import { blankCard, type AnyCard, type BookEntry } from '@/core/card';
import { buildCardContext } from './context';

function entry(partial: Partial<BookEntry>, id: number): BookEntry {
  return {
    id,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    constant: false,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    use_regex: false,
    extensions: {},
    ...partial,
  };
}

function richCard(): AnyCard {
  const card = blankCard('林晚');
  const data = card.data as Record<string, unknown>;
  data.description = '描述'.repeat(400); // 800 字
  data.personality = '温柔但固执';
  data.scenario = '大学校园';
  data.first_mes = '开场白'.repeat(400); // 1200 字
  data.character_book = {
    name: 'book',
    entries: [
      entry({ comment: '世界观', constant: true, content: '蓝灯内容'.repeat(300) }, 1), // 1200 字
      entry({ comment: '角色', constant: true, content: '蓝灯二' }, 2),
      entry({ comment: '图书馆', keys: ['图书馆', '图书'], content: '绿灯命中内容' }, 3),
      entry({ comment: '食堂', keys: ['食堂'], content: '绿灯未命中内容' }, 4),
    ],
  };
  data.extensions = {
    regex_scripts: [{ scriptName: '状态栏渲染', markdownOnly: true, promptOnly: false }],
    TavernHelper_scripts: [{ name: 'MVU 变量系统' }],
  };
  return card;
}

describe('buildCardContext 预算化组装', () => {
  it('包含基础字段与蓝灯条目全文（截 1000）', () => {
    const ctx = buildCardContext(richCard(), { budget: 20000 });
    expect(ctx).toContain('【角色名】林晚');
    expect(ctx).toContain('温柔但固执');
    expect(ctx).toContain('【描述】');
    expect(ctx).toContain('【世界书·常驻】世界观：');
    expect(ctx.length).toBeLessThan(20000);
  });

  it('描述截 500 / 开场白截 1000', () => {
    const ctx = buildCardContext(richCard(), { budget: 30000 });
    const desc = /【描述】((?:描述)+)/.exec(ctx)![1]!;
    expect(desc).toHaveLength(500);
    const mes = /【开场白（节选）】((?:开场白)+)/.exec(ctx)![1]!;
    // 1000 字截断落在词中间时按字面切片（999+1 残字）
    expect(mes.length).toBeLessThanOrEqual(1000);
    expect(mes.length).toBeGreaterThan(990);
  });

  it('绿灯按 matchText 命中：命中的进、未命中的不进', () => {
    const ctx = buildCardContext(richCard(), { matchText: '我们去图书馆看书', budget: 30000 });
    expect(ctx).toContain('绿灯命中内容');
    expect(ctx).not.toContain('绿灯未命中内容');
  });

  it('无 matchText 回退前 20 条绿灯', () => {
    const card = blankCard('t');
    (card.data as Record<string, unknown>).character_book = {
      name: '',
      entries: Array.from({ length: 25 }, (_, i) => entry({ comment: `g${i}`, keys: [`k${i}`], content: `c${i}` }, i + 1)),
    };
    const ctx = buildCardContext(card, { budget: 30000 });
    expect(ctx).toContain('c19');
    expect(ctx).not.toContain('c20\n');
    expect(ctx).toContain('【世界书·触发】g19');
  });

  it('预算超支即止并注明剩余未展示', () => {
    const ctx = buildCardContext(richCard(), { budget: 900 });
    expect(ctx.length).toBeLessThanOrEqual(1200);
    expect(ctx).toContain('条世界书条目未展示');
  });

  it('附正则与脚本清单（各前 5）', () => {
    const ctx = buildCardContext(richCard(), { budget: 30000 });
    expect(ctx).toContain('【正则脚本（前 1/1）】状态栏渲染 [只渲染]');
    expect(ctx).toContain('【酒馆助手脚本（前 1/1）】MVU 变量系统');
  });
});
