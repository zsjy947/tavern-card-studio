/**
 * ST 组装黄金样本门禁（合成卡）。
 *
 * 每个场景 = 一份 tests/fixtures/st-golden/<name>.json（input + expected.messages）。
 * 断言：assemblePrompt 产出的分段按同角色相邻合并后与 expected 逐字节一致。
 * 这是世界书引擎/正则管线/组装顺序的回归底线；真机黄金样本（ST 实机导出，
 * 校准流程见本地文档 docs/st-golden-guide.md，不入库）落在同目录并以
 * source:"real-st" 标记，同一机制校验。
 *
 * 更新方式：语义有意变更后跑 `UPDATE_GOLDEN=1 npx vitest run st-golden` 重新冻结，
 * 再人工检查 diff（冻结产物进 git，可逐字节审）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePrompt, ST_DEFAULT_SETTINGS } from '../src/core/st';
import { parseLooseCard } from '../src/core/card/normalize';
import { mergeSegmentsForExport } from '../src/services/xrayService';
import { makeChat, type MakeChatItem } from './factories/card';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'st-golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

interface GoldenScenario {
  name: string;
  description: string;
  card: Record<string, unknown>;
  chat: MakeChatItem[];
  settings?: Record<string, unknown>;
  seed?: number;
}

const v3 = (data: Record<string, unknown>): Record<string, unknown> => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: { name: '小雪', extensions: {}, ...data },
});

const scenarios: GoldenScenario[] = [
  {
    name: 'field-order-basic',
    description: '基础块序：主提示词→描述→性格→场景（空对话无历史段）',
    card: v3({ description: '白发少女', personality: '温柔', scenario: '雪国' }),
    chat: [],
  },
  {
    name: 'wi-blue-green',
    description: '蓝灯恒注入；绿灯键命中；未命中条目不出现',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: [], content: '蓝灯内容：世界观设定', constant: true, insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
          { id: 2, keys: ['雪'], content: '绿灯内容：下雪时的反应', insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
          { id: 3, keys: ['花'], content: '不会出现的条目', insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
        ],
      },
    }),
    chat: [{ role: 'user', content: '外面下雪了' }],
  },
  {
    name: 'wi-position-after',
    description: 'position=after 的条目排在角色字段之后、历史之前',
    card: v3({
      description: '白发少女',
      character_book: {
        name: 'b',
        entries: [{ id: 1, keys: ['雪'], content: '后置条目', insertion_order: 100, enabled: true, position: 'after_char', extensions: { position: 1 } }],
      },
    }),
    chat: [{ role: 'user', content: '下雪了' }],
  },
  {
    name: 'wi-selective-and-any',
    description: 'selectiveLogic=AND_ANY：primary+至少一个 secondary 命中才激活',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['键'], secondary_keys: ['红'], content: '复合条件条目', insertion_order: 100, enabled: true, position: 'before_char', extensions: { selectiveLogic: 0 } },
        ],
      },
    }),
    chat: [{ role: 'user', content: '键与红色都在' }],
  },
  {
    name: 'wi-recursion-chain',
    description: '递归：A 激活后其内容触发 B',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['雪'], content: 'A 的内容里提到花', insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
          { id: 2, keys: ['花'], content: 'B 被递归激活', insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
        ],
      },
    }),
    chat: [{ role: 'user', content: '下雪' }],
  },
  {
    name: 'wi-probability-50',
    description: 'probability=50：同 seed 结果确定（本 seed 下通过）',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['雪'], content: '概率条目', insertion_order: 100, enabled: true, position: 'before_char', extensions: { probability: 50, useProbability: true } },
        ],
      },
    }),
    chat: [{ role: 'user', content: '下雪' }],
    seed: 7,
  },
  {
    name: 'wi-group-election',
    description: '同组条目按 groupWeight 选举出一条（本 seed 下低 order 者胜）',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['键'], content: '甲（order 200）', insertion_order: 200, enabled: true, position: 'before_char', extensions: { group: 'g', group_weight: 50 } },
          { id: 2, keys: ['键'], content: '乙（order 100）', insertion_order: 100, enabled: true, position: 'before_char', extensions: { group: 'g', group_weight: 50 } },
        ],
      },
    }),
    chat: [{ role: 'user', content: '键' }],
    seed: 3,
  },
  {
    name: 'wi-budget-drops',
    description: '预算 100 token：低优先级条目被丢弃',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['键'], content: '长'.repeat(60), insertion_order: 200, enabled: true, position: 'before_char', extensions: {} },
          { id: 2, keys: ['键'], content: '长'.repeat(60), insertion_order: 100, enabled: true, position: 'before_char', extensions: {} },
        ],
      },
    }),
    chat: [{ role: 'user', content: '键' }],
    settings: { contextSize: 1000, wiBudgetPercent: 10 },
  },
  {
    name: 'regex-prompt-path',
    description: 'promptOnly 正则作用于 AI 历史消息；markdownOnly 不进提示词',
    card: v3({
      first_mes: '嗨',
      extensions: {
        regex_scripts: [
          { id: 'r1', scriptName: '隐藏数字', findRegex: '\\d+', replaceString: 'N', placement: [2], promptOnly: true, trimStrings: [] },
          { id: 'r2', scriptName: '显示装饰', findRegex: '嗨', replaceString: '【嗨】', placement: [0], markdownOnly: true, trimStrings: [] },
        ],
      },
    }),
    chat: [
      { role: 'assistant', content: '嗨 幸运7' },
      { role: 'user', content: '嗯' },
    ],
  },
  {
    name: 'macros-in-history',
    description: '历史消息宏展开（char/user/random 按 seed 确定性）',
    card: v3({ name: '小雪' }),
    chat: [{ role: 'assistant', content: '{{char}}：你好 {{user}}，今天是{{random:红,蓝}}色' }],
    settings: { userName: '阿明', mainPrompt: '' },
    seed: 5,
  },
  {
    name: 'wi-at-depth-injection',
    description: 'position=atDepth depth=1：注入到末条消息之前',
    card: v3({
      character_book: {
        name: 'b',
        entries: [
          { id: 1, keys: ['雪'], content: '深度注入内容', insertion_order: 100, enabled: true, position: 'before_char', extensions: { position: 4, depth: 1, role: 0 } },
        ],
      },
    }),
    chat: [
      { role: 'assistant', content: '嗨' },
      { role: 'user', content: '一' },
      { role: 'assistant', content: '雪' },
    ],
  },
  {
    name: 'author-note-injection',
    description: '作者注释按深度注入（depth=1 → 末条之前）',
    card: v3({}),
    chat: [
      { role: 'assistant', content: '嗨' },
      { role: 'user', content: '二' },
      { role: 'assistant', content: '雪' },
    ],
    settings: { mainPrompt: '', authorNote: { content: '注意保持叙事节奏', depth: 1, role: 'system' } },
  },
];

describe('ST 组装黄金样本（合成卡）', () => {
  it('场景数 ≥ 10（防场景表被误清）', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(10);
  });

  for (const sc of scenarios) {
    it(`${sc.name}：${sc.description}`, () => {
      if (UPDATE) mkdirSync(DIR, { recursive: true });
      const settings = { ...ST_DEFAULT_SETTINGS, ...(sc.settings ?? {}) };
      const result = assemblePrompt(parseLooseCard(sc.card), makeChat(sc.chat), settings, sc.seed ?? 1234);
      const merged = mergeSegmentsForExport(result.segments);
      const file = join(DIR, `${sc.name}.json`);
      if (UPDATE) {
        writeFileSync(
          file,
          `${JSON.stringify(
            {
              name: sc.name,
              description: sc.description,
              source: 'synthetic',
              input: { card: sc.card, chat: sc.chat, settings: sc.settings ?? null, seed: sc.seed ?? 1234 },
              expected: { messages: merged },
            },
            null,
            2,
          )}\n`,
        );
      }
      expect(existsSync(file), `缺黄金样本 ${file}，先以 UPDATE_GOLDEN=1 冻结`).toBe(true);
      const frozen = JSON.parse(readFileSync(file, 'utf-8')) as { expected: { messages: { role: string; content: string }[] } };
      expect(merged).toStrictEqual(frozen.expected.messages);
    });
  }
});
