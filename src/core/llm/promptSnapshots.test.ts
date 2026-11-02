/**
 * 生成类 prompt 快照回归（ROADMAP §三.7）：把生成管线的提示词全文冻结进快照，
 * 防止无意改词导致 LLM 产出漂移（改提示词必须是有意为之——快照 diff 会显式暴露）。
 * 有意调整提示词后运行 `npx vitest run -u` 重冻结，并在提交说明里写明改动动机。
 */
import { describe, expect, it } from 'vitest';
import {
  STATUSBAR_SYSTEM_PROMPT,
  buildContinuePrompt,
  buildHtmlPrompt,
  buildTextPrompt,
  buildVarListPrompt,
  type StatusbarVarPath,
} from './htmlgen';
import { buildBatchSystemPrompt, buildBatchUserPrompt, type WorldbookGenParams } from '@/core/lorebook/generate';

const VAR_LIST: StatusbarVarPath[] = [
  { group: '主角', field: '名称', type: 'string', default: '' },
  { group: '主角', field: '货币.石质天元', type: 'number', default: '0' },
  { group: '世界', field: '时间', type: 'string', default: '清晨' },
];

const WB_PARAMS: WorldbookGenParams = {
  worldview: '东方修仙世界，灵气复苏，宗门林立。',
  entryTypes: ['system', 'npc'],
  tierIndex: 1,
  style: 'auto',
  extraRequirement: '',
};

describe('生成类 prompt 快照回归', () => {
  it('STATUSBAR_SYSTEM_PROMPT（系统提示词锚点）', () => {
    expect(STATUSBAR_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it('buildVarListPrompt（变量路径设计，含用户需求）', () => {
    expect(buildVarListPrompt('【测试卡】修仙模拟器\n描述：一个修仙世界的模拟器卡。', '侧重好感度与物品栏')).toMatchSnapshot();
  });

  it('buildHtmlPrompt（MVU 状态栏，深色科技 + 多页签）', () => {
    expect(buildHtmlPrompt('【测试卡】修仙模拟器', VAR_LIST, 'dark', 'tabs', '带进度条')).toMatchSnapshot();
  });

  it('buildTextPrompt（纯文本状态栏）', () => {
    expect(buildTextPrompt('【测试卡】修仙模拟器', 'light', 'single')).toMatchSnapshot();
  });

  it('buildContinuePrompt（截断续写路径）', () => {
    const html = '<html><body><div class="tab-btn" data-target="a"></div></body></html>';
    expect(buildContinuePrompt(html, ['a'])).toMatchSnapshot();
  });

  it('buildBatchSystemPrompt（世界书批量生成系统提示词）', () => {
    expect(buildBatchSystemPrompt(WB_PARAMS)).toMatchSnapshot();
  });

  it('buildBatchUserPrompt（首跑 / 续跑防重名 / 带参考小说三种形态）', () => {
    expect(buildBatchUserPrompt(WB_PARAMS, [], 0, 35)).toMatchSnapshot();
    expect(buildBatchUserPrompt(WB_PARAMS, ['青云宗', '灵石体系'], 1, 35)).toMatchSnapshot();
    expect(buildBatchUserPrompt(WB_PARAMS, ['青云宗'], 1, 35, '第一章：林凡踏入青云宗……')).toMatchSnapshot();
  });
});
