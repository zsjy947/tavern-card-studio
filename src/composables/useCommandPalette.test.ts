import { describe, it, expect } from 'vitest';
import { registerCommand, unregisterCommand, listCommands, searchCommands, fuzzyMatch, resolveText } from './useCommandPalette';

describe('命令面板注册表', () => {
  it('注册/注销/列举', () => {
    const off = registerCommand({ id: 't1', title: '测试命令', group: '测试', run: () => {} });
    expect(listCommands().some((c) => c.id === 't1')).toBe(true);
    off();
    expect(listCommands().some((c) => c.id === 't1')).toBe(false);
    registerCommand({ id: 't2', title: '再来一个', group: '测试', run: () => {} });
    unregisterCommand('t2');
    expect(listCommands().some((c) => c.id === 't2')).toBe(false);
  });

  it('重复 id 覆盖', () => {
    registerCommand({ id: 'dup', title: '第一版', group: 'g', run: () => {} });
    registerCommand({ id: 'dup', title: '第二版', group: 'g', run: () => {} });
    expect(listCommands().find((c) => c.id === 'dup')?.title).toBe('第二版');
    unregisterCommand('dup');
  });
});

describe('模糊搜索', () => {
  const cmd = { id: 'x', title: '打开 · 卡库', group: '导航', keywords: '卡片 library 列表', run: () => {} };

  it('惰性文案：注册时 key、解析时取最新值（i18n 消息晚于注册的回归锚点）', () => {
    let label = 'command.open'; // 模拟消息表未就绪时 t() 返回原始 key
    registerCommand({ id: 'lazy', title: () => `打开 · ${label}`, group: () => '导航', run: () => {} });
    const item = listCommands().find((c) => c.id === 'lazy')!;
    expect(resolveText(item.title)).toBe('打开 · command.open'); // 未就绪：raw key（但不是冻结的注册值）
    label = '卡库'; // 消息表就绪 / 切语言
    expect(resolveText(item.title)).toBe('打开 · 卡库'); // 渲染时自动跟随
    expect(fuzzyMatch('卡库', item)).toBe(true);         // 搜索也用解析后的文案
    unregisterCommand('lazy');
  });

  it('空查询全中', () => {
    expect(fuzzyMatch('', cmd)).toBe(true);
  });

  it('前缀/子序列/拼音关键字命中', () => {
    expect(fuzzyMatch('卡库', cmd)).toBe(true);
    expect(fuzzyMatch('lib', cmd)).toBe(true);       // keywords 命中
    expect(fuzzyMatch('打库', cmd)).toBe(true);       // 子序列（打开·卡库）
  });

  it('不命中', () => {
    expect(fuzzyMatch('zzz', cmd)).toBe(false);
  });

  it('searchCommands 按分组排序', () => {
    registerCommand({ id: 'b', title: 'Beta', group: '导航', run: () => {} });
    registerCommand({ id: 'a', title: 'Alpha', group: '操作', run: () => {} });
    const res = searchCommands('');
    const groups = res.map((c) => resolveText(c.group));
    // 与实现一致：分组 localeCompare 升序
    const expected = [...groups].sort((x, y) => x.localeCompare(y));
    expect(groups).toEqual(expected);
    unregisterCommand('b');
    unregisterCommand('a');
  });
});
