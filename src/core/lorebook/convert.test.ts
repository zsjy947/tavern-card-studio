import { describe, it, expect } from 'vitest';
import {
  characterBookToWorldInfo, worldInfoToCharacterBook, embeddedToWiEntry, wiEntryToEmbedded,
  WI_POSITION, dedupeEntries, newWorldInfoEntry,
} from './convert';
import type { BookEntry, CharacterBook } from '../card/schema';

const entry: BookEntry = {
  id: 3,
  keys: ['主键1', '主键2'],
  secondary_keys: ['副键'],
  comment: '测试条目',
  content: '内容正文',
  constant: false,
  selective: true,
  insertion_order: 250,
  enabled: true,
  position: 'after_char',
  use_regex: false,
  extensions: {
    position: WI_POSITION.ANTop,          // ST 高级位置
    exclude_recursion: true,
    probability: 60,
    useProbability: true,
    depth: 7,
    selectiveLogic: 1,
    display_index: 5,
    vectorized: true,
  },
};

const book: CharacterBook = { name: '测试书', extensions: {}, entries: [entry] };

describe('内嵌 → ST 全局', () => {
  it('基础字段映射（对齐 ST convertCharacterBook）', () => {
    const wi = characterBookToWorldInfo(book);
    const e = wi.entries['3']!;
    expect(e.uid).toBe(3);
    expect(e.key).toEqual(['主键1', '主键2']);
    expect(e.keysecondary).toEqual(['副键']);
    expect(e.order).toBe(250);
    expect(e.disable).toBe(false);
    expect(e.addMemo).toBe(true);
  });

  it('extensions 优先于 position 字符串（高级位置保留）', () => {
    const wi = characterBookToWorldInfo(book);
    expect(wi.entries['3']!.position).toBe(WI_POSITION.ANTop);
  });

  it('无 extensions 时 before/after 映射', () => {
    const e = embeddedToWiEntry({ ...entry, position: 'after_char', extensions: {} });
    expect(e.position).toBe(WI_POSITION.after);
  });

  it('ST 专属字段完整落到条目（不丢失）', () => {
    const wi = characterBookToWorldInfo(book);
    const e = wi.entries['3']!;
    expect(e.excludeRecursion).toBe(true);
    expect(e.probability).toBe(60);
    expect(e.depth).toBe(7);
    expect(e.selectiveLogic).toBe(1);
    expect(e.vectorized).toBe(true);
  });
});

describe('ST 全局 → 内嵌', () => {
  it('双向往返保持语义', () => {
    const wi = characterBookToWorldInfo(book);
    const back = worldInfoToCharacterBook(wi, '测试书');
    const e = back.entries[0]!;
    expect(e.id).toBe(3);
    expect(e.keys).toEqual(['主键1', '主键2']);
    expect(e.secondary_keys).toEqual(['副键']);
    expect(e.insertion_order).toBe(250);
    expect(e.content).toBe('内容正文');
    // 高级位置：嵌入卡只能表达 before/after，但原值保留在 extensions.position
    expect(e.extensions.position).toBe(WI_POSITION.ANTop);
    expect(e.extensions.probability).toBe(60);
    expect(e.extensions.depth).toBe(7);
  });

  it('ST 扁平条目 → 嵌套（enable/disable 翻转）', () => {
    const wiEntry = newWorldInfoEntry(9, { key: ['k'], disable: true, order: 42, position: WI_POSITION.after });
    const e = wiEntryToEmbedded(wiEntry);
    expect(e.enabled).toBe(false);
    expect(e.insertion_order).toBe(42);
    expect(e.position).toBe('after_char');
    expect(e.extensions.position).toBe(WI_POSITION.after);
  });
});

describe('去重', () => {
  it('keys+content 相同的条目合并', () => {
    const dup = { ...entry, id: 99 };
    const { entries, removed } = dedupeEntries([entry, dup, { ...entry, id: 100, content: '不同内容' }]);
    expect(entries).toHaveLength(2);
    expect(removed).toBe(1);
  });
});
