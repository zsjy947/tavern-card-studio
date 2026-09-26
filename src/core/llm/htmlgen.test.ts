import { describe, expect, it } from 'vitest';
import {
  STATUSBAR_SYSTEM_PROMPT,
  buildContinuePrompt,
  buildHtmlPrompt,
  buildTextPrompt,
  buildVarListPrompt,
  checkPathDrift,
  cleanHtmlComments,
  extractHtml,
  findMissingTabs,
  isHtmlComplete,
  mergeContinuation,
  scanStatDataPaths,
  varElementId,
  varGroupsToPaths,
  varListToMvuGroups,
  type StatusbarVarPath,
} from './htmlgen';

const varList: StatusbarVarPath[] = [
  { group: '主角', field: '名称', type: 'string', default: '' },
  { group: '主角', field: '货币.石质天元', type: 'number', default: '0' },
  { group: '伙伴1', field: '好感度', type: 'number', default: '0' },
];

const COMPLETE_HTML = `<!doctype html><html><head><style>/* x */</style></head>
<body>
<div class="tab-btn" data-target="p1">一</div>
<div class="tab-btn" data-target="p2">二</div>
<div id="p1" class="tab-content">内容一</div>
<div id="p2" class="tab-content">内容二</div>
</body></html>`;

describe('htmlgen 变量清单 prompt', () => {
  it('三步思考法与反模板原则注入', () => {
    const p = buildVarListPrompt('卡上下文……', '修仙卡，显示境界');
    expect(p).toContain('数据盘点');
    expect(p).toContain('结构规划');
    expect(p).toContain('路径设计');
    expect(p).toContain('不要套模板');
    expect(p).toContain('卡上下文……');
    expect(p).toContain('修仙卡，显示境界');
  });
});

describe('htmlgen HTML prompt', () => {
  it('包含变量读取代码与硬约束', () => {
    const p = buildHtmlPrompt('上下文', varList, 'dark', 'tabs', '加个进度条');
    expect(p).toContain(`$("#${'主角-名称'}")`);
    expect(p).toContain(`_.get(all_variables, 'stat_data.主角.货币.石质天元', 0)`);
    expect(p).toContain(varElementId(varList[1]!));
    expect(p).toContain('tab-btn');
    expect(p).toContain('data-target');
    expect(p).toContain('禁止 // 注释');
    expect(p).toContain('禁止使用 vh');
    expect(p).toContain('</body></html>'.replace('</body></html>', '</body>'));
    expect(p).toContain('加个进度条');
    expect(STATUSBAR_SYSTEM_PROMPT).toContain('完整 HTML');
  });

  it('纯文本模式 prompt 含 StatusData 机制', () => {
    const p = buildTextPrompt('上下文', 'light', 'single');
    expect(p).toContain('<StatusData>');
    expect(p).toContain('__statusRawText');
  });
});

describe('htmlgen 完整性检测与续写', () => {
  it('isHtmlComplete：闭合 + tab 配对', () => {
    expect(isHtmlComplete(COMPLETE_HTML)).toBe(true);
    expect(isHtmlComplete('<html><body><div data-target="p1">btn</div></body></html>')).toBe(false);
    expect(isHtmlComplete('<html><body><div>未闭合')).toBe(false);
    expect(isHtmlComplete('<div data-target="a"></div>')).toBe(false);
  });

  it('findMissingTabs 找出缺内容的 tab', () => {
    expect(findMissingTabs(COMPLETE_HTML)).toHaveLength(0);
    const missing = findMissingTabs('<div data-target="p1">一</div><div data-target="p2">二</div><div id="p1"></div>');
    expect(missing).toEqual(['p2']);
  });

  it('buildContinuePrompt + mergeContinuation 修复缺 tab 与截断两种情形', () => {
    // 截断（无结尾）
    const truncated = '<html><body><div>abc';
    const c1 = buildContinuePrompt(truncated, []);
    expect(c1.user).toContain('从断点处继续');
    expect(c1.user).toContain('abc');
    // 有结尾但缺 tab：先剥离旧结尾再续写
    const closedMissing = COMPLETE_HTML.replace('<div id="p2" class="tab-content">内容二</div>', '');
    const missing = findMissingTabs(closedMissing);
    expect(missing).toEqual(['p2']);
    const c2 = buildContinuePrompt(closedMissing, missing);
    expect(c2.user).toContain('p2');
    expect(c2.user).toContain('已有代码末尾');
    const merged = mergeContinuation(closedMissing, '<div id="p2" class="tab-content">内容二</div></div></body></html>', missing);
    expect(merged).not.toMatch(/<\/body>\s*<\/body>/);
    expect(isHtmlComplete(merged)).toBe(true);
  });

  it('extractHtml 支持代码块与裸输出', () => {
    expect(extractHtml('```html\n<div>x</div>\n```')).toBe('<div>x</div>');
    expect(extractHtml('<div>y</div>')).toBe('<div>y</div>');
  });

  it('cleanHtmlComments 只清 body 内注释', () => {
    const html = '<html><head><style>/* keep */</style></head><body>/* drop */\n\n\n<p>x</p></body></html>';
    const out = cleanHtmlComments(html);
    expect(out).toContain('/* keep */');
    expect(out).not.toContain('/* drop */');
  });
});

describe('htmlgen 三方路径校验', () => {
  it('scanStatDataPaths / varGroupsToPaths / checkPathDrift', () => {
    const html = `<script>$('#a').text(_.get(all_variables, 'stat_data.主角.名称', ''));</script>`;
    expect(scanStatDataPaths(html)).toEqual(['主角.名称']);
    const groups = varListToMvuGroups(varList);
    expect(varGroupsToPaths(groups)).toContain('主角.货币.石质天元');
    // 只读 `_` 前缀不参与校验
    expect(varGroupsToPaths([{ name: 'G', fields: [{ name: '_r' }, { name: 'x' }] }])).toEqual(['G.x']);

    const drift = checkPathDrift(groups, html + `<script>_.get(all_variables,'stat_data.幽灵.路径','')</script>`);
    expect(drift.onlyInHtml).toContain('幽灵.路径');
    expect(drift.onlyInGroups).toContain('主角.货币.石质天元');
    expect(drift.onlyInGroups).not.toContain('主角.名称');
  });
});
