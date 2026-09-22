/**
 * 内置正则模板：常用清理/渲染脚本（含与状态栏模板配套的占位渲染器）。
 */
import type { TemplateRow } from '@/services/types';
import type { RegexScript } from '@/core/card';

export interface RegexPayload {
  script: Omit<RegexScript, 'id'>;
  /** 高级模式才暴露的字段说明 */
  note: string;
}

const mk = (scriptName: string, findRegex: string, replaceString: string, placement: number[], note: string, extra: Partial<RegexScript> = {}): RegexPayload => ({
  script: { scriptName, findRegex, replaceString, trimStrings: [], placement, disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...extra },
  note,
});

export function builtinRegexTemplates(): TemplateRow[] {
  const defs: [string, string, RegexPayload][] = [
    ['tpl-rx-clean-think', '清理思考标签', mk(
      '清理思考标签', '/<think>[\\s\\S]*?<\\/think>/g', '', [2],
      '移除部分推理模型的 <think>…</think> 过程文本，只留正文',
    )],
    ['tpl-rx-clean-status', '清理分析/状态标签', mk(
      '清理分析标签', '/<Analysis>[\\s\\S]*?<\\/Analysis>|<StatusBlock>[\\s\\S]*?<\\/StatusBlock>/g', '', [2],
      '移除卡内私用的分析/状态块输出（配合脚本流卡）',
    )],
    ['tpl-rx-trim-quote', '去除首尾引号', mk(
      '去除首尾引号', '/(^\\s*\\"|\\"\\s*$)/g', '', [2],
      '部分模型爱给整段对话套引号，此脚本剥掉',
    )],
    ['tpl-rx-br', '换行转 <br>', mk(
      '换行转br', '/\\n/g', '<br>', [0],
      '只影响渲染显示，不进入上下文（markdownOnly 类用法）', { markdownOnly: true },
    )],
    ['tpl-rx-user-say', '抑制重复用户名', mk(
      '抑制重复用户名', '/^{{user}}:\\s*/gm', '', [2],
      'AI 输出里不要复述玩家名前缀',
    )],
  ];
  return defs.map(([id, name, payload]) => ({
    id,
    kind: 'regex' as const,
    name,
    description: payload.note,
    payload,
    builtin: true,
    createdAt: '',
    updatedAt: '',
  }));
}
