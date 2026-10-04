import { describe, it, expect } from 'vitest';
import { createChatState, pushMessage, depthFromEnd, type ChatState } from './chat';
import { ST_DEFAULT_SETTINGS, worldInfoBudgetTokens } from './settings';
import { parseLooseCard } from '../card/normalize';

const v3Card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '小雪',
    first_mes: '*雪地里回过头*「你来了？」',
    description: '白发少女',
  },
};

describe('createChatState', () => {
  it('开场白作为首条 assistant 消息，宏保持原文不展开', () => {
    const card = parseLooseCard({ ...v3Card, data: { ...v3Card.data, first_mes: '{{char}}：你好，{{user}}' } });
    const chat = createChatState(card, '阿明');
    expect(chat.charName).toBe('小雪');
    expect(chat.userName).toBe('阿明');
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]!.role).toBe('assistant');
    expect(chat.messages[0]!.content).toBe('{{char}}：你好，{{user}}');
  });

  it('无开场白时消息为空', () => {
    const card = parseLooseCard({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'x' } });
    expect(createChatState(card).messages).toHaveLength(0);
  });
});

describe('消息操作', () => {
  it('pushMessage 追加并重排 id', () => {
    const card = parseLooseCard(v3Card);
    const chat = createChatState(card);
    pushMessage(chat, 'user', '我来了');
    pushMessage(chat, 'assistant', '欢迎');
    expect(chat.messages.map((m) => m.id)).toStrictEqual(['m0', 'm1', 'm2']);
    expect(chat.messages.map((m) => m.role)).toStrictEqual(['assistant', 'user', 'assistant']);
  });

  it('depthFromEnd：末条为 0，向前递增', () => {
    const total = 4;
    expect(depthFromEnd(3, total)).toBe(0);
    expect(depthFromEnd(0, total)).toBe(3);
  });
});

describe('worldInfoBudgetTokens', () => {
  it('默认 25% × 8192', () => {
    expect(worldInfoBudgetTokens(ST_DEFAULT_SETTINGS)).toBe(2048);
  });

  it('BudgetCap 收窄；书内 token_budget>0 直接取书值', () => {
    expect(worldInfoBudgetTokens({ ...ST_DEFAULT_SETTINGS, wiBudgetCap: 1000 })).toBe(1000);
    expect(worldInfoBudgetTokens(ST_DEFAULT_SETTINGS, 500)).toBe(500);
    expect(worldInfoBudgetTokens(ST_DEFAULT_SETTINGS, 0)).toBe(2048);
  });

  it('百分比越界钳制到 [0,100]', () => {
    expect(worldInfoBudgetTokens({ ...ST_DEFAULT_SETTINGS, wiBudgetPercent: 150 })).toBe(8192);
    expect(worldInfoBudgetTokens({ ...ST_DEFAULT_SETTINGS, wiBudgetPercent: -5 })).toBe(0);
  });
});

describe('ChatState 形状', () => {
  it('vars 初始为空对象，可独立演化', () => {
    const card = parseLooseCard(v3Card);
    const a: ChatState = createChatState(card);
    const b: ChatState = createChatState(card);
    a.vars['x'] = 1;
    expect(b.vars).toStrictEqual({});
  });
});
