/**
 * 共享测试卡/对话工厂——终结各测试文件私抄 V3 骨架的现状。
 * 只做最小合理默认：字段可通过 overrides 覆盖，产出经 parseLooseCard 归一化。
 */

import { parseLooseCard } from '../../src/core/card/normalize';
import type { AnyCard } from '../../src/core/card/schema';
import type { ChatRole } from '../../src/core/st/settings';
import type { ChatState } from '../../src/core/st/chat';

export interface MakeCardOverrides {
  spec?: string;
  data?: Record<string, unknown>;
}

export function makeCard(overrides: MakeCardOverrides = {}): AnyCard {
  return parseLooseCard({
    spec: overrides.spec ?? 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '测试角色',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
      ...(overrides.data ?? {}),
    },
  });
}

export interface MakeChatItem {
  role: ChatRole;
  content: string;
}

export function makeChat(items: MakeChatItem[], charName = '测试角色', userName = 'User'): ChatState {
  return {
    charName,
    userName,
    vars: {},
    messages: items.map((m, i) => ({ id: `m${i}`, role: m.role, content: m.content })),
  };
}

/** 卡内世界书条目（嵌套形态；ST 专属字段走 extensions）。id 用进程内单调计数，保持确定性 */
let entrySeq = 0;
export function makeBookEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ++entrySeq,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    constant: false,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    extensions: {},
    ...overrides,
  };
}
