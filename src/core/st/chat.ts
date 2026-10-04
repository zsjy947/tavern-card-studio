/**
 * 线性对话状态：M1 无消息树 / swipe / 群聊（明确不支持清单项）。
 * timed（sticky/cooldown 剩余计数）由 worldinfo 引擎逐楼推进，本模块只做存储。
 * 消息内容存宏原文（与 ST 一致：存储不展开，组装时求值）。
 */

import type { AnyCard } from '../card/schema';
import type { ChatRole } from './settings';

export interface ChatMessage {
  /** 稳定 id：`m{index}`，随位置变化（仅作 UI key 用，不参与持久化） */
  id: string;
  role: ChatRole;
  content: string;
}

export interface ChatState {
  charName: string;
  userName: string;
  messages: ChatMessage[];
  /** {{getvar}}/{{setvar}} 变量表 */
  vars: Record<string, unknown>;
}

/** 由卡创建初始对话：开场白（first_mes）作为首条 assistant 消息 */
export function createChatState(card: AnyCard, userName = 'User'): ChatState {
  const data = card.data as Record<string, unknown>;
  const messages: ChatMessage[] = [];
  const greeting = typeof data.first_mes === 'string' ? data.first_mes : '';
  if (greeting.trim()) messages.push({ id: 'm0', role: 'assistant', content: greeting });
  return {
    charName: String(data.name ?? ''),
    userName,
    messages,
    vars: {},
  };
}

/** 追加一条消息（id 按新长度重排，保持 m{index} 约定） */
export function pushMessage(state: ChatState, role: ChatRole, content: string): ChatState {
  state.messages.push({ id: `m${state.messages.length}`, role, content });
  return state;
}

/** 消息深度：距对话末端的楼层数（最后一条 = 0），minDepth/maxDepth 与 atDepth/AN 注入的度量单位 */
export function depthFromEnd(index: number, total: number): number {
  return total - 1 - index;
}
