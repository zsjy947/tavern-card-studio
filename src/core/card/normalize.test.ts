import { describe, it, expect } from 'vitest';
import { parseLooseCard, migrateV2toV3, downgradeV3toV2, convertSpec, blankCard, cardSpec } from './normalize';
import { SPEC_V2, SPEC_V3 } from './schema';
import { dataHash } from './hash';

/** V1 顶层格式（最老社区卡） */
const V1_CARD = {
  name: '旧角色',
  description: '一段描述',
  personality: '温柔',
  scenario: '咖啡馆',
  first_mes: '你好，{{user}}。',
  mes_example: '<START>',
  tags: '旧卡, 中文', // 字符串形式
  creatorcomment: '作者留言',
};

/** 规范 V2 */
const V2_CARD = {
  spec: SPEC_V2,
  spec_version: '2.0',
  data: {
    name: 'V2 角色',
    description: 'desc',
    personality: '',
    scenario: '',
    first_mes: 'hi {{user}}',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: ['alt1'],
    tags: ['a', 'b'],
    creator: '',
    character_version: '',
    extensions: { talkativeness: '0.5' },
  },
};

/** V3（带嵌套世界书与正则） */
const V3_CARD = {
  spec: SPEC_V3,
  spec_version: '3.0',
  data: {
    ...V2_CARD.data,
    name: 'V3 角色',
    character_book: {
      name: 'book',
      entries: [{
        id: 0, keys: ['k1'], secondary_keys: [], comment: 'c', content: 'content',
        constant: true, selective: false, insertion_order: 100, enabled: true,
        position: 'before_char', use_regex: false,
        extensions: { position: 0, probability: 80, depth: 4 },
      }],
    },
    extensions: {
      regex_scripts: [{
        id: 'r1', scriptName: 's', findRegex: '/<x\\/>/g', replaceString: '',
        trimStrings: [], placement: [2], disabled: false,
        markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0,
        minDepth: null, maxDepth: null,
      }],
      depth_prompt: { prompt: 'p', depth: 4, role: 'system' },
    },
  },
};

describe('parseLooseCard 归一化', () => {
  it('V1 顶层 → 内部规范形态（data 块 + 默认值 + tags 拆分）', () => {
    const card = parseLooseCard(V1_CARD);
    expect(card.data.name).toBe('旧角色');
    expect(card.data.tags).toEqual(['旧卡', '中文']);
    expect(card.data.creator_notes).toBe('作者留言');
    expect(card.data.alternate_greetings).toEqual([]);
    expect(card.data.extensions).toBeDefined();
  });

  it('V2 保持字段', () => {
    const card = parseLooseCard(V2_CARD);
    expect(card.spec).toBe(SPEC_V2);
    expect(card.data.alternate_greetings).toEqual(['alt1']);
    expect(card.name).toBe('V2 角色'); // 顶层冗余
  });

  it('V3 嵌套世界书与正则完整保留', () => {
    const card = parseLooseCard(V3_CARD);
    expect(card.spec).toBe(SPEC_V3);
    const d = card.data as unknown as typeof V3_CARD.data;
    expect(d.character_book?.entries[0]?.extensions.probability).toBe(80);
    expect(d.extensions.regex_scripts?.[0]?.scriptName).toBe('s');
  });

  it('spec 缺失时按 V2 容错', () => {
    const card = parseLooseCard({ data: { name: 'x', description: 'y' } });
    expect(card.spec).toBe(SPEC_V2);
  });

  it('顶层字段与 data 冲突时 data 优先', () => {
    const card = parseLooseCard({ ...V2_CARD, name: '顶层旧名' });
    expect(card.data.name).toBe('V2 角色');
  });
});

describe('规格迁移', () => {
  it('V1 → V3 直接迁移可用', () => {
    const v3 = convertSpec(parseLooseCard(V1_CARD), 'v3');
    expect(cardSpec(v3)).toBe('v3');
    expect(v3.data.name).toBe('旧角色');
  });

  it('V2 → V3 平移 + v3 字段默认', () => {
    const v3 = migrateV2toV3(parseLooseCard(V2_CARD));
    expect(v3.spec).toBe(SPEC_V3);
    expect(v3.data.name).toBe('V2 角色');
    expect((v3.data as { nickname: string }).nickname).toBe('');
  });

  it('V3 → V2 丢弃 v3 专属字段但保留共享字段', () => {
    const v2 = downgradeV3toV2(parseLooseCard(V3_CARD));
    expect(v2.spec).toBe(SPEC_V2);
    expect(v2.data.name).toBe('V3 角色');
    expect(v2.data.character_book?.entries).toHaveLength(1);
    expect('nickname' in v2.data).toBe(false);
  });

  it('blankCard 出厂即 V3', () => {
    expect(cardSpec(blankCard('新'))).toBe('v3');
  });
});

describe('dataHash', () => {
  it('同内容不同键序哈希一致', () => {
    const a = dataHash({ name: 'x', description: 'y', tags: ['a'] });
    const b = dataHash({ tags: ['a'], description: 'y', name: 'x' });
    expect(a).toBe(b);
  });

  it('噪声字段不影响（create_date / fav）', () => {
    const a = dataHash({ name: 'x', create_date: '1' });
    const b = dataHash({ name: 'x', fav: true, create_date: '2' });
    expect(a).toBe(b);
  });

  it('内容变化哈希变化', () => {
    expect(dataHash({ name: 'x' })).not.toBe(dataHash({ name: 'y' }));
  });
});
