import { describe, it, expect } from 'vitest';
import { runWorldInfo, cardWorldInfoEntries, type WiSourceEntry } from './worldinfo';
import { newWorldInfoEntry, WI_LOGIC, WI_POSITION } from '../lorebook/convert';
import type { Rng } from './rng';
import { mulberry32 } from './rng';
import { ST_DEFAULT_SETTINGS, type StSettings } from './settings';
import type { ChatState } from './chat';
import { parseLooseCard } from '../card/normalize';

/** 固定值 rng：probability/组选举断言用 */
function fixedRng(v: number): Rng {
  const f = (() => v) as Rng;
  f.seed = 1;
  return f;
}

const baseSettings = (): StSettings => ({ ...ST_DEFAULT_SETTINGS });

function chatOf(...items: { role: 'user' | 'assistant'; content: string }[]): ChatState {
  return {
    charName: 'C',
    userName: 'U',
    vars: {},
    messages: items.map((m, i) => ({ id: `m${i}`, role: m.role, content: m.content })),
  };
}

function entry(uid: number, overrides: Partial<WiSourceEntry> = {}): WiSourceEntry {
  return newWorldInfoEntry(uid, { key: ['键'], content: '内容', ...overrides });
}

function run(entries: WiSourceEntry[], chat: ChatState, settings = baseSettings(), rng: Rng = fixedRng(0), book = {}) {
  return runWorldInfo({ entries, chat, settings, rng, book });
}

describe('基础激活', () => {
  it('空对话蓝灯仍激活（constant）', () => {
    const r = run([entry(1, { constant: true })], chatOf());
    expect(r.traces[0]!.activated).toBe(true);
    expect(r.traces[0]!.lamp).toBe('blue');
    expect(r.traces[0]!.reason).toStrictEqual({ kind: 'constant' });
    expect(r.injections).toHaveLength(1);
  });

  it('绿灯键在扫描窗口内命中', () => {
    const r = run([entry(1, { key: ['雪'] })], chatOf({ role: 'user', content: '外面下雪了' }));
    expect(r.traces[0]!.reason).toMatchObject({ kind: 'keyword', matchedKeys: ['雪'] });
    expect(r.scanText).toContain('雪');
  });

  it('未命中给出 no-key-match', () => {
    const r = run([entry(1, { key: ['雪'] })], chatOf({ role: 'user', content: '晴天' }));
    expect(r.traces[0]!.reason).toStrictEqual({ kind: 'no-key-match' });
    expect(r.injections).toHaveLength(0);
  });

  it('scanDepth 窗口外不命中；条目级 scanDepth 可扩窗', () => {
    const chat = chatOf({ role: 'user', content: '下雪' }, { role: 'assistant', content: '晴天' });
    const narrow = run([entry(1, { key: ['雪'] })], chat, { ...baseSettings(), wiScanDepth: 1 });
    expect(narrow.traces[0]!.activated).toBe(false);
    const widened = run([entry(1, { key: ['雪'], scanDepth: 2 })], chat, { ...baseSettings(), wiScanDepth: 1 });
    expect(widened.traces[0]!.activated).toBe(true);
  });

  it('大小写默认不敏感；条目级 caseSensitive 收紧', () => {
    const chat = chatOf({ role: 'user', content: 'the Snow falls' });
    expect(run([entry(1, { key: ['snow'] })], chat).traces[0]!.activated).toBe(true);
    expect(run([entry(1, { key: ['snow'], caseSensitive: true })], chat).traces[0]!.reason).toStrictEqual({ kind: 'no-key-match' });
  });

  it('整词匹配只约束拉丁词形键，CJK 键回退子串', () => {
    const chat1 = chatOf({ role: 'user', content: 'concatenate' });
    expect(run([entry(1, { key: ['cat'] })], chat1).traces[0]!.activated).toBe(false);
    const chat2 = chatOf({ role: 'user', content: 'a cat runs' });
    expect(run([entry(1, { key: ['cat'] })], chat2).traces[0]!.activated).toBe(true);
    const chat3 = chatOf({ role: 'user', content: '下雪了' });
    expect(run([entry(1, { key: ['雪'] })], chat3).traces[0]!.activated).toBe(true);
  });

  it('use_regex 键按正则解释', () => {
    const r = run([entry(1, { key: ['/雪+天/'], useRegex: true })], chatOf({ role: 'user', content: '今雪雪天转晴' }));
    expect(r.traces[0]!.activated).toBe(true);
  });

  it('禁用与向量条目跳过', () => {
    const r = run([entry(1, { constant: true, disable: true }), entry(2, { vectorized: true, key: ['x'], content: 'x' })], chatOf({ role: 'user', content: 'x' }));
    expect(r.traces[0]!.reason).toStrictEqual({ kind: 'disabled' });
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'vectorized' });
  });
});

describe('secondary 键与 selectiveLogic', () => {
  const chatRed = chatOf({ role: 'user', content: '键 红色' });
  const chatRedBlue = chatOf({ role: 'user', content: '键 红色 蓝色' });

  it('AND_ANY：至少一个 secondary 命中', () => {
    const e = entry(1, { key: ['键'], keysecondary: ['红'], selectiveLogic: WI_LOGIC.AND_ANY });
    expect(run([e], chatRed).traces[0]!.activated).toBe(true);
    expect(run([e], chatOf({ role: 'user', content: '键' })).traces[0]!.reason).toMatchObject({ kind: 'secondary-failed' });
  });

  it('AND_ALL：全部命中才通过', () => {
    const e = entry(1, { key: ['键'], keysecondary: ['红', '蓝'], selectiveLogic: WI_LOGIC.AND_ALL });
    expect(run([e], chatRedBlue).traces[0]!.activated).toBe(true);
    expect(run([e], chatRed).traces[0]!.reason).toMatchObject({ kind: 'secondary-failed', logic: WI_LOGIC.AND_ALL });
  });

  it('NOT_ANY：任一命中即失败', () => {
    const e = entry(1, { key: ['键'], keysecondary: ['红'], selectiveLogic: WI_LOGIC.NOT_ANY });
    expect(run([e], chatRed).traces[0]!.reason).toMatchObject({ kind: 'secondary-failed', logic: WI_LOGIC.NOT_ANY });
    expect(run([e], chatOf({ role: 'user', content: '键' })).traces[0]!.activated).toBe(true);
  });

  it('NOT_ALL：全部命中才失败', () => {
    const e = entry(1, { key: ['键'], keysecondary: ['红', '蓝'], selectiveLogic: WI_LOGIC.NOT_ALL });
    expect(run([e], chatRedBlue).traces[0]!.reason).toMatchObject({ kind: 'secondary-failed', logic: WI_LOGIC.NOT_ALL });
    expect(run([e], chatRed).traces[0]!.activated).toBe(true);
  });
});

describe('timedEffects 与概率', () => {
  it('delay：消息数未到则不激活', () => {
    const e = entry(1, { key: ['键'], delay: 3 });
    expect(run([e], chatOf({ role: 'user', content: '键' })).traces[0]!.reason).toMatchObject({ kind: 'delayed', needMessages: 3 });
    const chat3 = chatOf({ role: 'user', content: '一' }, { role: 'user', content: '二' }, { role: 'user', content: '键' });
    expect(run([e], chat3).traces[0]!.activated).toBe(true);
  });

  it('probability：同 seed 可复现，记录掷骰值', () => {
    const e = entry(1, { key: ['键'], probability: 50 });
    const chat = chatOf({ role: 'user', content: '键' });
    expect(run([e], chat, baseSettings(), fixedRng(0.49)).traces[0]!.activated).toBe(true);
    const failed = run([e], chat, baseSettings(), fixedRng(0.5));
    expect(failed.traces[0]!.activated).toBe(false);
    expect(failed.traces[0]!.reason).toStrictEqual({ kind: 'probability-failed', roll: 0.5, threshold: 50 });
  });

  it('sticky：触发后 N 楼内免键维持，到期失效', () => {
    const e = entry(1, { key: ['雪'], sticky: 2 });
    const chat3 = chatOf({ role: 'user', content: '雪' }, { role: 'user', content: '晴' }, { role: 'user', content: '晴' });
    const r3 = run([e], chat3);
    expect(r3.traces[0]!.activated).toBe(true);
    expect(r3.traces[0]!.reason).toStrictEqual({ kind: 'sticky' });
    const chat4 = chatOf({ role: 'user', content: '雪' }, { role: 'user', content: '晴' }, { role: 'user', content: '晴' }, { role: 'user', content: '晴' });
    const r4 = run([e], chat4);
    // 触发楼 0 的 sticky 覆盖 0..2，第 4 楼已失效
    expect(r4.traces[0]!.activated).toBe(false);
    expect(r4.traces[0]!.reason).toStrictEqual({ kind: 'no-key-match' });
  });

  it('cooldown：触发后 N 楼内不可再触发', () => {
    const e = entry(1, { key: ['雪'], cooldown: 2 });
    const chat = chatOf({ role: 'user', content: '雪' }, { role: 'user', content: '晴' }, { role: 'user', content: '雪' });
    const r = run([e], chat);
    expect(r.traces[0]!.activated).toBe(false);
    expect(r.traces[0]!.reason).toMatchObject({ kind: 'cooldown', remaining: 1 });
  });
});

describe('递归扫描', () => {
  const a = () => entry(1, { key: ['雪'], content: '提到花' });
  const b = () => entry(2, { key: ['花'], content: 'B 内容' });

  it('A 的内容触发 B（recursive 且可归因）', () => {
    const r = run([a(), b()], chatOf({ role: 'user', content: '下雪' }));
    expect(r.traces[1]!.activated).toBe(true);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'recursive', viaUid: 1 });
  });

  it('preventRecursion 阻断以其为源的递归', () => {
    // 唯一激活源的 preventRecursion=true：其内容不能再去触发 C
    const r = run(
      [entry(1, { key: ['雪'], content: '提到花', preventRecursion: true }), entry(2, { key: ['花'], content: 'C' })],
      chatOf({ role: 'user', content: '雪' }),
    );
    expect(r.traces[0]!.activated).toBe(true);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'no-key-match' });
  });

  it('excludeRecursion 条目不可被递归激活', () => {
    const r = run([a(), entry(2, { excludeRecursion: true, key: ['花'], content: 'B' })], chatOf({ role: 'user', content: '雪' }));
    expect(r.traces[1]!.activated).toBe(false);
  });

  it('delayUntilRecursion 只走递归通道', () => {
    const delayed = entry(2, { key: ['花'], content: 'B', delayUntilRecursion: true });
    expect(run([delayed], chatOf({ role: 'user', content: '花' })).traces[0]!.reason).toStrictEqual({ kind: 'delay-until-recursion' });
    const r = run([a(), delayed], chatOf({ role: 'user', content: '雪' }));
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'recursive', viaUid: 1 });
  });

  it('recursiveScanning=false 时 delayUntilRecursion 永不激活', () => {
    const delayed = entry(1, { key: ['花'], content: 'B', delayUntilRecursion: true });
    const r = run([delayed], chatOf({ role: 'user', content: '花' }), baseSettings(), fixedRng(0), { recursiveScanning: false });
    expect(r.traces[0]!.reason).toStrictEqual({ kind: 'recursion-disabled' });
  });

  it('wiMaxRecursionSteps 限制链长', () => {
    const chain = [
      entry(1, { key: ['雪'], content: '花' }),
      entry(2, { key: ['花'], content: '月' }),
      entry(3, { key: ['月'], content: 'C' }),
    ];
    const r = run(chain, chatOf({ role: 'user', content: '雪' }), { ...baseSettings(), wiMaxRecursionSteps: 1 });
    expect(r.traces[1]!.activated).toBe(true);
    expect(r.traces[2]!.activated).toBe(false);
  });
});

describe('组选举', () => {
  it('加权选举确定，败者记 group-lost', () => {
    const e1 = entry(1, { key: ['键'], group: 'g', groupWeight: 50, order: 200 });
    const e2 = entry(2, { key: ['键'], group: 'g', groupWeight: 50, order: 100 });
    // r=0.3*100=30，首选（order 200）权重 50 即命中 → e1 胜出
    const r = run([e1, e2], chatOf({ role: 'user', content: '键' }), baseSettings(), fixedRng(0.3));
    expect(r.traces[0]!.activated).toBe(true);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'group-lost', winnerUid: 1 });
  });

  it('groupOverride 强制胜出', () => {
    const e1 = entry(1, { key: ['键'], group: 'g', groupOverride: true });
    const e2 = entry(2, { key: ['键'], group: 'g', order: 200 });
    const r = run([e1, e2], chatOf({ role: 'user', content: '键' }));
    expect(r.traces[0]!.activated).toBe(true);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'group-lost', winnerUid: 1 });
  });
});

describe('预算填充', () => {
  const fat = (uid: number, order: number, chars = 150) => entry(uid, { key: ['键'], content: '长'.repeat(chars), order });

  it('超预算按优先级丢弃（budget-dropped）', () => {
    const s = { ...baseSettings(), contextSize: 1000, wiBudgetPercent: 10 }; // 100 token 预算
    // 60 token × 2：order 200 先占 60，order 100 再放 120>100 → 丢弃
    const r = run([fat(1, 200, 60), fat(2, 100, 60)], chatOf({ role: 'user', content: '键' }), s);
    expect(r.budgetTokens).toBe(100);
    expect(r.traces[0]!.activated).toBe(true);
    expect(r.traces[0]!.reason).toStrictEqual({ kind: 'keyword', matchedKeys: ['键'], messageIndex: 0 });
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'budget-dropped' });
  });

  it('ignoreBudget 条目不计预算恒注入', () => {
    const s = { ...baseSettings(), contextSize: 1000, wiBudgetPercent: 10 };
    const r = run([fat(1, 200), entry(2, { key: ['键'], content: 'x'.repeat(500), ignoreBudget: true, order: 1 })], chatOf({ role: 'user', content: '键' }), s);
    expect(r.traces[1]!.activated).toBe(true);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'keyword', matchedKeys: ['键'], messageIndex: 0 });
  });

  it('minActivations 无视预算回补', () => {
    const s = { ...baseSettings(), contextSize: 1000, wiBudgetPercent: 10, wiMinActivations: 1 };
    const r = run([fat(1, 200), fat(2, 100)], chatOf({ role: 'user', content: '键' }), s);
    const kept = r.traces.filter((t) => t.activated);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.uid).toBe(1);
  });

  it('书级 token_budget 覆盖全局预算', () => {
    const r = run([fat(1, 200), fat(2, 100)], chatOf({ role: 'user', content: '键' }), baseSettings(), fixedRng(0), { tokenBudget: 10 });
    expect(r.budgetTokens).toBe(10);
    expect(r.traces[1]!.reason).toStrictEqual({ kind: 'budget-dropped' });
  });
});

describe('cardWorldInfoEntries', () => {
  it('携带 useRegex 旁路与书级覆盖', () => {
    const card = parseLooseCard({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'x',
        character_book: {
          name: 'b',
          scan_depth: 5,
          token_budget: 300,
          recursive_scanning: false,
          entries: [
            { id: 1, keys: ['/a+/'], content: 'c', use_regex: true, extensions: { position: WI_POSITION.atDepth, depth: 2 } },
          ],
        },
      },
    });
    const { entries, book } = cardWorldInfoEntries(card);
    expect(entries[0]!.useRegex).toBe(true);
    expect(entries[0]!.position).toBe(WI_POSITION.atDepth);
    expect(entries[0]!.depth).toBe(2);
    expect(book).toStrictEqual({ scanDepth: 5, tokenBudget: 300, recursiveScanning: false });
  });

  it('同 seed 同输入重放一致', () => {
    const chat = chatOf({ role: 'user', content: '键 a' }, { role: 'user', content: '键 b' });
    const entries = [entry(1, { key: ['键'], probability: 50 }), entry(2, { key: ['a'], content: '提到键' })];
    const r1 = run(entries, chat, baseSettings(), mulberry32(7));
    const r2 = run(entries, chat, baseSettings(), mulberry32(7));
    expect(r1.traces).toStrictEqual(r2.traces);
  });
});
