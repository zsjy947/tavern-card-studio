import { describe, it, expect } from 'vitest';
import { applyRegexPipeline } from './regex';
import { regexScriptSchema, type RegexScript } from '../card/schema';
import { REGEX_PLACEMENT } from '../regex/model';

function script(overrides: Partial<RegexScript> = {}): RegexScript {
  return regexScriptSchema.parse({
    id: 's1',
    scriptName: '测试脚本',
    findRegex: 'a',
    replaceString: 'b',
    placement: [],
    trimStrings: [],
    ...overrides,
  });
}

const opts = (over: Partial<Parameters<typeof applyRegexPipeline>[2]> = {}) => ({
  placement: REGEX_PLACEMENT.AI_OUTPUT,
  path: 'prompt' as const,
  macroCtx: { char: 'C', user: 'U' },
  ...over,
});

describe('applyRegexPipeline', () => {
  it('placement 不符则跳过', () => {
    const r = applyRegexPipeline([script({ placement: [REGEX_PLACEMENT.USER_INPUT] })], 'aaa', opts());
    expect(r.text).toBe('aaa');
    expect(r.traces[0]).toMatchObject({ applied: false, skipReason: '位置不符' });
  });

  it('depth 过滤：minDepth/maxDepth 按距末端楼层', () => {
    const s = script({ findRegex: 'a', replaceString: 'b', placement: [REGEX_PLACEMENT.AI_OUTPUT], minDepth: 2, maxDepth: 4 });
    expect(applyRegexPipeline([s], 'aaa', opts({ depthFromEnd: 1 })).text).toBe('aaa');
    expect(applyRegexPipeline([s], 'aaa', opts({ depthFromEnd: 3 })).text).toBe('bbb');
    expect(applyRegexPipeline([s], 'aaa', opts({ depthFromEnd: 5 })).text).toBe('aaa');
  });

  it('双通路：promptOnly 不进渲染，markdownOnly 不进提示词，无标记两路都走', () => {
    const promptOnly = script({ findRegex: 'x', replaceString: 'P', placement: [REGEX_PLACEMENT.AI_OUTPUT], promptOnly: true });
    expect(applyRegexPipeline([promptOnly], 'x', opts({ path: 'display' })).text).toBe('x');
    expect(applyRegexPipeline([promptOnly], 'x', opts({ path: 'prompt' })).text).toBe('P');
    const mdOnly = script({ findRegex: 'x', replaceString: 'D', placement: [REGEX_PLACEMENT.AI_OUTPUT], markdownOnly: true });
    expect(applyRegexPipeline([mdOnly], 'x', opts({ path: 'prompt' })).text).toBe('x');
    expect(applyRegexPipeline([mdOnly], 'x', opts({ path: 'display' })).text).toBe('D');
    const both = script({ findRegex: 'x', replaceString: 'B', placement: [REGEX_PLACEMENT.AI_OUTPUT] });
    expect(applyRegexPipeline([both], 'x', opts({ path: 'prompt' })).text).toBe('B');
    expect(applyRegexPipeline([both], 'x', opts({ path: 'display' })).text).toBe('B');
  });

  it('{{match}} 代表整段匹配，$1 捕获组语义保留', () => {
    const m = script({ findRegex: '\\d+', replaceString: '[{{match}}]', placement: [REGEX_PLACEMENT.AI_OUTPUT] });
    expect(applyRegexPipeline([m], 'a123b456', opts()).text).toBe('a[123]b[456]');
    const cap = script({ findRegex: '(\\d)-(\\d)', replaceString: '$2$1', placement: [REGEX_PLACEMENT.AI_OUTPUT] });
    expect(applyRegexPipeline([cap], '3-4', opts()).text).toBe('43');
  });

  it('\\n 转真换行；trimStrings 剔除', () => {
    const s = script({ findRegex: 'a', replaceString: 'x\\ny', placement: [REGEX_PLACEMENT.AI_OUTPUT], trimStrings: ['y'] });
    expect(applyRegexPipeline([s], 'aa', opts()).text).toBe('x\nx\n');
  });

  it('substituteRegex=1 在 findRegex 中展开宏', () => {
    const s = script({ findRegex: '{{getvar::目标}}', replaceString: 'X', placement: [REGEX_PLACEMENT.AI_OUTPUT], substituteRegex: 1 });
    const ctx = { macroCtx: { char: 'C', user: 'U', vars: { 目标: '钥' } } };
    expect(applyRegexPipeline([s], '一把钥', opts(ctx)).text).toBe('一把X');
    expect(applyRegexPipeline([script({ ...s, substituteRegex: 0 })], '一把钥', opts(ctx)).text).toBe('一把钥');
  });

  it('禁用脚本跳过；语法错误跳过并留痕', () => {
    const r = applyRegexPipeline([script({ disabled: true }), script({ findRegex: '([', replaceString: 'x' })], 'aaa', opts());
    expect(r.text).toBe('aaa');
    expect(r.traces[0]).toMatchObject({ applied: false, skipReason: '已禁用' });
    expect(r.traces[1]).toMatchObject({ applied: false });
    expect(r.traces[1]!.skipReason).toContain('正则语法错误');
  });

  it('trace 记录 changed', () => {
    const r = applyRegexPipeline([script({ findRegex: 'zzz', replaceString: 'y' })], 'aaa', opts());
    expect(r.traces[0]).toMatchObject({ applied: true, changed: false });
  });
});
