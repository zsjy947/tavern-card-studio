import { describe, it, expect } from 'vitest';
import { TemplateEngine, renderTemplate, scanVariables } from './variables';

describe('TemplateEngine', () => {
  it('{{user}}/{{char}} 替换', () => {
    expect(renderTemplate('{{char}} 对 {{user}} 说话', { char: '小雪', user: '阿明' })).toBe('小雪 对 阿明 说话');
  });

  it('大小写不敏感', () => {
    expect(renderTemplate('{{User}} 和 {{CHAR}}', { user: 'U', char: 'C' })).toBe('U 和 C');
  });

  it('缺失时不替换（保持原样）', () => {
    expect(renderTemplate('{{user}} 来了', {})).toBe('{{user}} 来了');
  });

  it('自定义变量 getvar/var 两种语法', () => {
    expect(renderTemplate('{{getvar::favor}} / {{var::energy}}', { vars: { favor: '23', energy: '87' } })).toBe('23 / 87');
  });

  it('setvar 先设置后渲染（顺序敏感）', () => {
    const out = new TemplateEngine({ vars: {} }).render('{{setvar:x=你好}}值是 {{getvar::x}}');
    expect(out).toBe('值是 你好');
  });

  it('random 带确定性 rng（可测试）', () => {
    const out = renderTemplate('{{random:a,b,c}}', { rng: () => 0 });
    expect(out).toBe('a');
    expect(renderTemplate('{{random:a,b,c}}', { rng: () => 0.99 })).toBe('c');
  });

  it('scanVariables 提取变量名', () => {
    expect(scanVariables('{{getvar::a}} {{var::b}} {{user}}')).toEqual(['a', 'b']);
  });
});
