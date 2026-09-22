/** 手动集成验证：用户指定的测试小说走一遍工坊本地处理链路（不调 LLM） */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitChapters, scanCharacterNames, collectContext } from '@/core/novel';

const NOVEL_PATH = 'D:/AAA_files/downloads/DIY/origin/穿成女频男主，我天天报警.txt';

describe('同人卡工坊 · 真实小说本地链路', () => {
  it.skipIf(!readFileSync(NOVEL_PATH, 'utf-8').length)('章节切分 / 角色扫描 / 上下文', () => {
    const text = readFileSync(NOVEL_PATH, 'utf-8');
    expect(text.length).toBeGreaterThan(100_000); // 是一整部长篇

    const chapters = splitChapters(text);
    expect(chapters.length).toBeGreaterThan(10);

    const names = scanCharacterNames(text, 20);
    expect(names.length).toBeGreaterThan(5);

    const top = names.slice(0, 5).map((n) => n.name);
    const ctx = collectContext(chapters, top, { maxChars: 50_000 });
    expect(ctx.hits).toBeGreaterThan(50);
    expect(ctx.text.length).toBeLessThanOrEqual(52_000);
  });
});
