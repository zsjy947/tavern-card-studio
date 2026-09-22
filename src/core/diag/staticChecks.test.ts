import { describe, it, expect } from 'vitest';
import { runStaticChecks } from './staticChecks';
import { parseLooseCard, blankCard, type AnyCard } from '../card';

function cardWith(overrides: Record<string, unknown>): AnyCard {
  return parseLooseCard({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '测试', description: '描述', first_mes: '你好 {{user}}', ...overrides } });
}

describe('静态检查', () => {
  it('健康卡无 error', () => {
    const issues = runStaticChecks(cardWith({}));
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('缺名字报 error', () => {
    const issues = runStaticChecks(cardWith({ name: '' }));
    expect(issues.some((i) => i.field === 'name' && i.severity === 'error')).toBe(true);
  });

  it('缺开场白报 error', () => {
    const issues = runStaticChecks(cardWith({ first_mes: '', alternate_greetings: [] }));
    expect(issues.some((i) => i.field === 'first_mes' && i.severity === 'error')).toBe(true);
  });

  it('token 超限告警', () => {
    const long = '描述内容各不相同。'.repeat(700); // BPE 后仍显著超过 descriptionTokens=4000
    const issues = runStaticChecks(cardWith({ description: long }));
    expect(issues.some((i) => i.field === 'description' && i.message.includes('超限'))).toBe(true);
  });

  it('世界书键冲突检测', () => {
    const book = {
      name: 'b',
      entries: [
        { id: 0, keys: ['共同键'], content: '内容A', comment: 'A', constant: false, selective: false, insertion_order: 100, enabled: true, position: 'before_char', use_regex: false, extensions: {} },
        { id: 1, keys: ['共同键'], content: '内容B', comment: 'B', constant: false, selective: false, insertion_order: 100, enabled: true, position: 'before_char', use_regex: false, extensions: {} },
      ],
    };
    const issues = runStaticChecks(cardWith({ character_book: book }));
    expect(issues.some((i) => i.message.includes('共同键'))).toBe(true);
  });

  it('无关键词且非常驻的条目提示', () => {
    const book = {
      name: 'b',
      entries: [{ id: 0, keys: [], content: 'x', comment: '', constant: false, selective: false, insertion_order: 100, enabled: true, position: 'before_char', use_regex: false, extensions: {} }],
    };
    const issues = runStaticChecks(cardWith({ character_book: book }));
    expect(issues.some((i) => i.message.includes('永远不会注入'))).toBe(true);
  });

  it('正则语法错误检测', () => {
    const issues = runStaticChecks(cardWith({
      extensions: { regex_scripts: [{ id: 'x', scriptName: '坏正则', findRegex: '/([unclosed/g', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null }] },
    }));
    expect(issues.some((i) => i.field === 'regex_scripts[0]' && i.severity === 'error')).toBe(true);
  });

  it('base64 嵌图体积警告（需求：应外链）', () => {
    const bigDataUrl = `data:image/png;base64,${'A'.repeat(3_000_000)}`; // ~2.2MB > 2048KB 阈值
    const issues = runStaticChecks(cardWith({ description: `<img src="${bigDataUrl}">` }));
    expect(issues.some((i) => i.field === 'embedded_images' && i.severity === 'warn')).toBe(true);
  });

  it('未使用 {{user}} 宏提示', () => {
    const issues = runStaticChecks(cardWith({ first_mes: '你好啊。' }));
    expect(issues.some((i) => i.field === 'macros')).toBe(true);
  });

  it('blankCard 通过基本检查', () => {
    const issues = runStaticChecks(blankCard('空卡'));
    expect(issues.some((i) => i.severity === 'error')).toBe(true); // 空卡缺描述/开场白，应当报错
  });
});
