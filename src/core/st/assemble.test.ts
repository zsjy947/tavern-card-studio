import { describe, it, expect } from 'vitest';
import { assemblePrompt } from './assemble';
import { ST_DEFAULT_SETTINGS, type StSettings } from './settings';
import { makeCard, makeChat, makeBookEntry } from '../../../tests/factories/card';

const settings = (over: Partial<StSettings> = {}): StSettings => ({ ...ST_DEFAULT_SETTINGS, ...over });

describe('assemblePrompt 消息序', () => {
  it('基础块序：主提示词 → 描述 → 性格 → 场景 → 历史（空段跳过）', () => {
    const card = makeCard({ data: { description: '白发少女', personality: '温柔', scenario: '雪国', first_mes: '你好' } });
    const r = assemblePrompt(card, makeChat([{ role: 'assistant', content: '你好' }]), settings({ mainPrompt: 'MAIN' }));
    expect(r.segments.map((s) => s.source)).toStrictEqual(['main-prompt', 'char-description', 'char-personality', 'scenario', 'history:0']);
    expect(r.segments[0]!.content).toBe('MAIN');
  });

  it('宏展开：{{char}}/{{user}} 在历史中替换', () => {
    const card = makeCard({ data: { name: '小雪', first_mes: '{{char}}：你好，{{user}}' } });
    const r = assemblePrompt(card, makeChat([{ role: 'assistant', content: '{{char}}：你好，{{user}}' }]), settings({ userName: '阿明', mainPrompt: '' }));
    expect(r.segments[0]!.content).toBe('小雪：你好，阿明');
  });

  it('世界书前置/后置归位', () => {
    const card = makeCard({
      data: {
        description: 'D',
        first_mes: '嗨',
        character_book: {
          name: 'b',
          entries: [
            makeBookEntry({ id: 1, keys: ['雪'], content: '前置条目', extensions: { position: 0 } }),
            makeBookEntry({ id: 2, keys: ['花'], content: '后置条目', extensions: { position: 1 } }),
          ],
        },
      },
    });
    const r = assemblePrompt(card, makeChat([{ role: 'user', content: '雪与花' }]), settings({ mainPrompt: 'MAIN' }));
    expect(r.segments.map((s) => s.source)).toStrictEqual(['main-prompt', 'wi:1', 'char-description', 'wi:2', 'history:0']);
  });

  it('示例对话单段（v1 近似），宏展开，EM 卫星挂其前后', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        mes_example: '<START>\n{{user}}: 你好\n{{char}}: 嗯',
        character_book: {
          name: 'b',
          entries: [
            makeBookEntry({ id: 1, keys: ['雪'], content: 'EM 上', extensions: { position: 5 } }),
            makeBookEntry({ id: 2, keys: ['花'], content: 'EM 下', extensions: { position: 6 } }),
          ],
        },
      },
    });
    const r = assemblePrompt(card, makeChat([{ role: 'user', content: '雪 花' }]), settings({ mainPrompt: '' }));
    expect(r.segments.map((s) => s.source)).toStrictEqual(['wi:1', 'examples', 'wi:2', 'history:0']);
    expect(r.segments[1]!.content).toBe('<START>\nUser: 你好\n测试角色: 嗯');
  });

  it('无示例段时 EM 条目挂历史最前', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        character_book: { name: 'b', entries: [makeBookEntry({ id: 1, keys: ['雪'], content: 'EM 位', extensions: { position: 5 } })] },
      },
    });
    const r = assemblePrompt(card, makeChat([{ role: 'user', content: '雪' }]), settings({ mainPrompt: '' }));
    expect(r.segments.map((s) => s.source)).toStrictEqual(['wi:1', 'history:0']);
  });
});

describe('楼内注入', () => {
  it('atDepth 按深度插队（depth=1 → 末条之前）', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        character_book: {
          name: 'b',
          entries: [makeBookEntry({ id: 1, keys: ['雪'], content: '深度内容', extensions: { position: 4, depth: 1, role: 0 } })],
        },
      },
    });
    const chat = makeChat([
      { role: 'assistant', content: '嗨' },
      { role: 'user', content: '一' },
      { role: 'assistant', content: '二' },
      { role: 'user', content: '雪' },
    ]);
    const r = assemblePrompt(card, chat, settings({ mainPrompt: '' }));
    expect(r.segments.map((s) => s.source)).toStrictEqual(['history:0', 'history:1', 'history:2', 'wi:1', 'history:3']);
  });

  it('作者注释挂 AN 深度；ANTop 条目在其上方', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        character_book: {
          name: 'b',
          entries: [makeBookEntry({ id: 1, keys: ['雪'], content: 'AN 上方', extensions: { position: 2, depth: 9 } })],
        },
      },
    });
    const chat = makeChat([
      { role: 'assistant', content: '嗨' },
      { role: 'user', content: '一' },
      { role: 'assistant', content: '雪' },
    ]);
    const r = assemblePrompt(
      card,
      chat,
      settings({ mainPrompt: '', authorNote: { content: '保持在四楼以内', depth: 1, role: 'system' } }),
    );
    // historyLen=3, AN depth 1 → cut=2：[history:0, history:1, wi:1(ANTop), an, history:2]
    expect(r.segments.map((s) => s.source)).toStrictEqual(['history:0', 'history:1', 'wi:1', 'an', 'history:2']);
  });

  it('PHI 顺序：卡片 PHI → 全局 PHI 收尾', () => {
    const card = makeCard({ data: { first_mes: '嗨', post_history_instructions: '卡 PHI' } });
    const r = assemblePrompt(card, makeChat([{ role: 'user', content: '你好' }]), settings({ mainPrompt: '', phiPrompt: '全 PHI' }));
    expect(r.segments.map((s) => s.source).slice(-2)).toStrictEqual(['phi-card', 'phi-global']);
  });
});

describe('正则与汇总', () => {
  const regexCard = () =>
    makeCard({
      data: {
        name: 'C',
        first_mes: '嗨',
        extensions: {
          regex_scripts: [
            { id: 'r1', scriptName: '隐藏数字', findRegex: '\\d+', replaceString: 'N', placement: [2], promptOnly: true, trimStrings: [] },
            { id: 'r2', scriptName: '显示装饰', findRegex: '嗨', replaceString: '【嗨】', placement: [0], markdownOnly: true, trimStrings: [] },
          ],
        },
      },
    });

  it('promptOnly 进提示词历史段；markdownOnly 只影响显示态对照', () => {
    const chat = makeChat([
      { role: 'assistant', content: '嗨 幸运7' },
      { role: 'user', content: '嗯' },
    ]);
    const r = assemblePrompt(regexCard(), chat, settings({ mainPrompt: '' }));
    const h0 = r.segments.find((s) => s.source === 'history:0')!;
    expect(h0.content).toBe('嗨 幸运N'); // prompt 通路：数字被替换，"嗨"保持
    expect(r.regexPreview).not.toBeNull();
    expect(r.regexPreview!.raw).toBe('嗨 幸运7');
    expect(r.regexPreview!.prompt).toBe('嗨 幸运N');
    expect(r.regexPreview!.display).toBe('【嗨】 幸运7'); // display 通路：markdownOnly 生效，promptOnly 不生效
  });

  it('token 汇总 = 逐段之和；bySource 可查', () => {
    const card = makeCard({ data: { description: '白发少女', first_mes: '你好呀' } });
    const r = assemblePrompt(card, makeChat([{ role: 'assistant', content: '你好呀' }]), settings({ mainPrompt: 'MAIN' }));
    expect(r.tokens.total).toBe(r.segments.reduce((s, x) => s + x.tokens, 0));
    expect(r.tokens.bySource['main-prompt']).toBe(r.segments[0]!.tokens);
  });

  it('未知宏进 warnings（去重）', () => {
    const card = makeCard({ data: { first_mes: '{{神秘宏}}' } });
    const r = assemblePrompt(
      card,
      makeChat([
        { role: 'assistant', content: '{{神秘宏}} 和 {{神秘宏}}' },
        { role: 'user', content: '{{另一个}}' },
      ]),
      settings({ mainPrompt: '' }),
    );
    expect(r.warnings.some((w) => w.includes('神秘宏'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('另一个'))).toBe(true);
  });

  it('同 seed 全量重放一致（probability 卡）', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        character_book: {
          name: 'b',
          entries: [makeBookEntry({ id: 1, keys: ['雪'], content: '概率条目', extensions: { position: 0, probability: 50, useProbability: true } })],
        },
      },
    });
    const chat = makeChat([{ role: 'user', content: '下雪' }]);
    const r1 = assemblePrompt(card, chat, settings(), 42);
    const r2 = assemblePrompt(card, chat, settings(), 42);
    expect(r1.segments).toStrictEqual(r2.segments);
    expect(r1.wiTraces).toStrictEqual(r2.wiTraces);
    const r3 = assemblePrompt(card, chat, settings(), 43);
    expect(JSON.stringify(r3.segments) === JSON.stringify(r1.segments)).toBe(true); // 单条目单楼：两 seed 结果同，但内部消耗路径已隔离
  });

  it('scanText/budgetTokens 透传', () => {
    const card = makeCard({
      data: {
        first_mes: '嗨',
        character_book: { name: 'b', scan_depth: 2, entries: [makeBookEntry({ id: 1, keys: ['雪'], content: 'C'.repeat(50) })] },
      },
    });
    const r = assemblePrompt(card, makeChat([{ role: 'user', content: '下雪了' }]), settings({ mainPrompt: '' }));
    expect(r.scanText).toBe('下雪了');
    expect(r.budgetTokens).toBe(2048);
  });
});
