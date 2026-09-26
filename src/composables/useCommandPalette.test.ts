import { describe, it, expect } from 'vitest';
import { registerCommand, unregisterCommand, listCommands, searchCommands, fuzzyMatch } from './useCommandPalette';

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
    const groups = res.map((c) => c.group);
    // 与实现一致：分组 localeCompare 升序
    const expected = [...groups].sort((x, y) => x.localeCompare(y));
    expect(groups).toEqual(expected);
    unregisterCommand('b');
    unregisterCommand('a');
  });
});
