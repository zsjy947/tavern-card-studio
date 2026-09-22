/**
 * 酒馆助手脚本（TavernHelper scripts）与 QuickReply 的导入/导出/编辑模型。
 */

import {
  quickReplySchema,
  tavernHelperScriptSchema,
  type QuickReply,
  type TavernHelperScript,
} from '../card/schema';

export interface TavernHelperExtension {
  scripts?: TavernHelperScript[];
  variables?: Record<string, unknown>;
}

/** 从卡 extensions 里读出助手脚本容器（兼容多种社区写法） */
export function readTavernHelper(ext: Record<string, unknown> | undefined): TavernHelperExtension {
  const th = (ext?.tavern_helper ?? {}) as TavernHelperExtension;
  return {
    scripts: Array.isArray(th.scripts) ? th.scripts.map((s) => tavernHelperScriptSchema.parse(s)) : [],
    variables: (th.variables ?? {}) as Record<string, unknown>,
  };
}

export function writeTavernHelper(current: TavernHelperExtension): Record<string, unknown> {
  return { ...current };
}

export function newHelperScript(overrides: Partial<TavernHelperScript> = {}): TavernHelperScript {
  return tavernHelperScriptSchema.parse({
    id: `th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: '新脚本',
    ...overrides,
  });
}

/* ---------------- QuickReply ---------------- */

export interface QuickReplySet {
  version?: number;
  name?: string;
  quickReplies: QuickReply[];
}

/** 导入 QuickReply v2 JSON（set 容器或裸数组） */
export function parseQuickReplySet(raw: unknown): QuickReplySet {
  if (Array.isArray(raw)) {
    return { quickReplies: raw.map((q) => quickReplySchema.parse(q)) };
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const list = (obj.quickReplies ?? obj.qrList ?? []) as unknown[];
  return {
    version: typeof obj.version === 'number' ? obj.version : 2,
    name: typeof obj.name === 'string' ? obj.name : '',
    quickReplies: list.map((q) => {
      const o = q as Record<string, unknown>;
      return quickReplySchema.parse({
        id: typeof o.id === 'string' ? o.id : `qr-${Math.random().toString(36).slice(2, 10)}`,
        label: (o.label ?? o.name ?? '未命名') as string,
        message: (o.message ?? '') as string,
        command: (o.command ?? '') as string,
        hidden: Boolean(o.hidden),
        executeOnStartup: Boolean(o.executeOnStartup),
        executeOnUser: Boolean(o.executeOnUser),
        executeOnAi: Boolean(o.executeOnAi),
      });
    }),
  };
}

export function serializeQuickReplySet(set: QuickReplySet): Record<string, unknown> {
  return {
    version: set.version ?? 2,
    name: set.name ?? '',
    quickReplies: set.quickReplies,
  };
}
