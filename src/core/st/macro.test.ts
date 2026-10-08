import { describe, it, expect } from 'vitest';
import { evaluateMacros } from './macro';
import { mulberry32 } from './rng';

describe('evaluateMacros', () => {
  it('{{user}}/{{char}} 替换与大小写不敏感', () => {
    const r = evaluateMacros('{{CHAR}} 对 {{user}} 说话', { char: '小雪', user: '阿明' });
    expect(r.text).toBe('小雪 对 阿明 说话');
  });

  it('user/char 缺失保留字面量（TemplateEngine 兼容语义）', () => {
    expect(evaluateMacros('{{user}} 来了', {}).text).toBe('{{user}} 来了');
    expect(evaluateMacros('{{char}} 来了', { user: 'U' }).text).toBe('{{char}} 来了');
  });

  it('getvar/var 双语法，缺失时替换为空串', () => {
    const ctx = { vars: { favor: '23', energy: '87' } };
    expect(evaluateMacros('{{getvar::favor}} / {{var::energy}} / {{getvar::none}}', ctx).text).toBe('23 / 87 / ');
  });

  it('setvar 双语法（ST :: 与旧 =），先设置后渲染顺序敏感', () => {
    expect(evaluateMacros('{{setvar::x::你好}}值是 {{getvar::x}}', {}).text).toBe('值是 你好');
    expect(evaluateMacros('{{setvar:y=世界}}值是 {{getvar::y}}', {}).text).toBe('值是 世界');
  });

  it('setvar 结果写入返回的 vars', () => {
    const r = evaluateMacros('{{setvar::hp::100}}', { vars: { old: '1' } });
    expect(r.vars).toStrictEqual({ old: '1', hp: '100' });
  });

  it('random/pick 同 rng 确定性，支持中英文逗号', () => {
    expect(evaluateMacros('{{random:a, b，c}}', { rng: () => 0 }).text).toBe('a');
    expect(evaluateMacros('{{pick:a,b,c}}', { rng: () => 0.99 }).text).toBe('c');
    const r1 = evaluateMacros('{{random:a,b,c}}{{random:a,b,c}}', { rng: mulberry32(7) });
    const r2 = evaluateMacros('{{random:a,b,c}}{{random:a,b,c}}', { rng: mulberry32(7) });
    expect(r1.text).toBe(r2.text);
  });

  it('roll 三种形态：N / AdN / 区间，且确定性', () => {
    const d = evaluateMacros('{{roll:20}}', { rng: () => 0.999 });
    expect(d.text).toBe('20');
    const dice = evaluateMacros('{{roll:2d6}}', { rng: () => 0.999 });
    expect(dice.text).toBe('12');
    const range = evaluateMacros('{{roll:3-7}}', { rng: () => 0 });
    expect(range.text).toBe('3');
    const bad = evaluateMacros('{{roll:abc}}', {});
    expect(bad.text).toBe('{{roll:abc}}');
    expect(bad.warnings.length).toBe(1);
  });

  it('{{match}} 有上下文取值，缺失保留字面量并告警', () => {
    expect(evaluateMacros('前{{match}}后', { match: '命中内容' }).text).toBe('前命中内容后');
    const r = evaluateMacros('前{{match}}后', {});
    expect(r.text).toBe('前{{match}}后');
    expect(r.warnings[0]).toContain('{{match}}');
  });

  it('time/date 使用注入的 now（可测试）', () => {
    const now = new Date('2026-10-04T15:08:00');
    const r = evaluateMacros('{{date}} {{time}}', { now });
    expect(r.text).toBe('2026/10/4 15:08');
  });

  it('未知宏保留字面量并去重告警', () => {
    const r = evaluateMacros('{{lastMessage}} 和 {{what}} 和 {{lastMessage}}', {});
    expect(r.text).toBe('{{lastMessage}} 和 {{what}} 和 {{lastMessage}}');
    expect(r.warnings).toHaveLength(2);
  });

  it('花括号内的空白可容忍', () => {
    expect(evaluateMacros('{{ user }}', { user: 'U' }).text).toBe('U');
  });

  it('非宏的花括号文本不受影响', () => {
    expect(evaluateMacros('JSON 示例 {"key": 1}', {}).text).toBe('JSON 示例 {"key": 1}');
  });
});
