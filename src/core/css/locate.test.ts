import { describe, expect, it } from 'vitest';
import { locateRule, normalizeSelector, parseCssRules } from './locate';
import { buildPickerScript, PICKED_MESSAGE, PICKER_START_MESSAGE } from './pickerScript';

const CSS = `/* 基础 */
.tcs-panel {
  display: flex;
  padding: 8px;
}
.tcs-panel .name { color: #fff; }
.bar:hover{color:red}
#main, .side { margin: 0; }
@media (max-width: 600px) {
  .tcs-panel { padding: 2px; }
}`;

describe('parseCssRules', () => {
  it('扫描规则块区间，跳过注释与字符串', () => {
    const blocks = parseCssRules(CSS);
    const selectors = blocks.map((b) => b.selector);
    expect(selectors).toContain('.tcs-panel');
    expect(selectors).toContain('.tcs-panel .name');
    expect(selectors).toContain('.bar:hover');
    expect(selectors).toContain('#main, .side');
    // media 内层块也被扫出
    expect(blocks.filter((b) => b.selector === '.tcs-panel')).toHaveLength(2);
    // 区间可用切片还原
    for (const b of blocks) expect(CSS.slice(b.start, b.end)).toContain('{');
  });
});

describe('normalizeSelector', () => {
  it('大小写/空白/伪类归一化', () => {
    expect(normalizeSelector('  .Panel > .Name ')).toBe('.panel>.name');
    expect(normalizeSelector('.bar:hover')).toBe('.bar');
    expect(normalizeSelector('.item:nth-of-type( 2 )')).toBe('.item');
    expect(normalizeSelector('A  .b')).toBe('a .b');
  });
});

describe('locateRule', () => {
  it('命中：返回规则块（同一选择器取最后一条）', () => {
    const r = locateRule(CSS, '.TCS-PANEL');
    expect(r.block).not.toBeNull();
    expect(r.suggestion).toBeNull();
    expect(r.matches).toHaveLength(2);
    // 最后一条在 media 内（padding: 2px）
    expect(r.block!.body).toContain('padding: 2px');
  });

  it('伪类点选命中无伪类规则', () => {
    const r = locateRule(CSS, '.bar:hover');
    expect(r.block!.selector).toBe('.bar:hover');
    expect(r.block!.body).toContain('color:red');
  });

  it('未命中：给出追加覆盖规则建议而非报错', () => {
    const r = locateRule(CSS, '.unknown-class');
    expect(r.block).toBeNull();
    expect(r.suggestion).toContain('.unknown-class');
    expect(r.suggestion).toContain('覆盖规则');
  });

  it('空选择器安全返回', () => {
    expect(locateRule(CSS, '  ').block).toBeNull();
    expect(locateRule(CSS, '  ').suggestion).toBeNull();
  });
});

describe('pickerScript', () => {
  it('注入脚本包含 finder 序列化与消息协议', () => {
    const s = buildPickerScript();
    expect(s).toContain('function finder'); // @medv/finder 序列化为具名函数
    expect(s).toContain(PICKER_START_MESSAGE);
    expect(s).toContain(PICKED_MESSAGE);
    expect(s).not.toContain('=>'); // ES5 风格 function，规避老内核（非硬约束，作冒烟检查）
  });
});
