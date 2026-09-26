// @vitest-environment happy-dom
/**
 * beautifyService 三件套插入流程测试（ROADMAP P3-1 / 迭代六 C2）：
 * MemoryStore 全链路（真实落库）+ 幂等断言 + AI 状态栏产物应用。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { setStore } from '@/db';
import { MemoryStore } from '@/db/drivers';
import { blankCard, type AnyCard } from '@/core/card';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';
import { insertStatusbar, buildMvuStatusbarArtifacts, buildTextStatusbarArtifacts, applyAiStatusbarArtifacts } from './beautifyService';
import * as cardService from './cardService';

const payload: StatusbarPayload = {
  tag: '<TestBar/>',
  html: '<div class="tcs-test">{{getvar::favor}}</div>',
  css: '.tcs-test{color:red}',
  js: '',
  variables: [
    { key: 'favor', label: '好感', initial: '10' },
    { key: 'money', label: '金钱', initial: '100', group: '资产' },
  ],
  worldinfoEntry: { comment: '测试状态栏规则', keys: ['状态栏'], content: '规则内容' },
  previewMock: { favor: '50', money: '999' },
};

describe('beautifyService 三件套插入（MemoryStore 全链路）', () => {
  beforeEach(() => setStore(new MemoryStore()));

  async function newCard(): Promise<{ id: string; card: AnyCard }> {
    const row = await cardService.createCard('测试卡');
    return { id: row.id, card: row.card };
  }

  it('插入：占位 tag + 渲染正则 + 蓝灯条目，变量初值替换', async () => {
    const { id, card } = await newCard();
    const next = insertStatusbar(card, payload, { variables: { favor: '42' }, charName: '林晚' }).card;
    const saved = await cardService.saveCard(id, next, { note: 'test' });

    const data = saved.card.data as Record<string, unknown>;
    expect(String(data.first_mes)).toContain('<TestBar/>');
    const scripts = (data.extensions as Record<string, unknown>).regex_scripts as { scriptName: string; replaceString: string }[];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.replaceString).toContain('42'); // 变量初值已替换
    expect(scripts[0]!.replaceString).toContain('color:red');
    const book = (data.character_book as { entries: { comment: string; constant: boolean }[] }).entries;
    expect(book.some((e) => e.comment === '测试状态栏规则' && e.constant)).toBe(true);
  });

  it('幂等：重复插入不叠加（同 tag 正则替换、条目去重）', async () => {
    const { id, card } = await newCard();
    const once = insertStatusbar(card, payload, {}).card;
    const twice = insertStatusbar(once, payload, {}).card;
    const saved = await cardService.saveCard(id, twice, {});
    const data = saved.card.data as Record<string, unknown>;
    const scripts = (data.extensions as Record<string, unknown>).regex_scripts as unknown[];
    expect(scripts).toHaveLength(1);
    const book = (data.character_book as { entries: unknown[] }).entries;
    expect(book.filter((e) => (e as { comment: string }).comment === '测试状态栏规则')).toHaveLength(1);
    // 占位 tag 只出现一次
    expect(String(data.first_mes).match(/<TestBar\/>/g)).toHaveLength(1);
  });

  it('改名后的变量正确重写进渲染 HTML', async () => {
    const { id, card } = await newCard();
    const next = insertStatusbar(card, payload, { variables: { favor: '7' } }).card;
    await cardService.saveCard(id, next, {});
    const row = await cardService.getCard(id);
    const scripts = ((row!.card.data as Record<string, unknown>).extensions as Record<string, unknown>).regex_scripts as { replaceString: string }[];
    expect(scripts[0]!.replaceString).toContain('7');
  });
});

describe('AI 状态栏产物（beautifyService 迭代五 E3）', () => {
  beforeEach(() => setStore(new MemoryStore()));

  it('MVU 模式：状态栏 HTML 围栏为占位符渲染正则 + 确保开场白占位符', async () => {
    const row = await cardService.createCard('MVU 卡');
    const artifacts = buildMvuStatusbarArtifacts('<html><style>.x{}</style></html>');
    const next = applyAiStatusbarArtifacts(row.card, artifacts);
    const data = next.data as Record<string, unknown>;
    const scripts = (data.extensions as Record<string, unknown>).regex_scripts as { scriptName: string; findRegex: string; replaceString: string; markdownOnly: boolean }[];
    expect(scripts.some((s) => s.scriptName === '[美化]状态栏渲染' && s.findRegex.includes('StatusPlaceHolderImpl') && s.markdownOnly)).toBe(true);
    expect(String(data.first_mes)).toContain('StatusPlaceHolderImpl');
  });

  it('纯文本模式：渲染正则 + 隐藏正则（minDepth=6）+ 蓝灯指令条目', () => {
    const card = blankCard('纯文本卡');
    const artifacts = buildTextStatusbarArtifacts('<html><body></body></html>');
    expect(artifacts.regexes).toHaveLength(2);
    const [render, hide] = artifacts.regexes;
    expect(render!.findRegex).toContain('StatusData');
    expect(render!.markdownOnly).toBe(true);
    expect(hide!.promptOnly).toBe(true);
    expect(hide!.minDepth).toBe(6);
    expect(artifacts.entries[0]!.comment).toBe('状态数据输出指令');
    expect(artifacts.entries[0]!.extensions.position).toBe(4);
    expect(artifacts.entries[0]!.insertion_order).toBe(200);

    const next = applyAiStatusbarArtifacts(card, artifacts);
    const book = (next.data as Record<string, unknown>).character_book as { entries: { comment: string }[] };
    expect(book.entries.some((e) => e.comment === '状态数据输出指令')).toBe(true);
  });

  it('应用幂等：同名脚本替换不叠加', () => {
    const card = blankCard('幂等卡');
    const once = applyAiStatusbarArtifacts(card, buildMvuStatusbarArtifacts('<html>a</html>'));
    const twice = applyAiStatusbarArtifacts(once, buildMvuStatusbarArtifacts('<html>b</html>'));
    const scripts = ((twice.data as Record<string, unknown>).extensions as Record<string, unknown>).regex_scripts as unknown[];
    expect(scripts).toHaveLength(1);
  });
});
