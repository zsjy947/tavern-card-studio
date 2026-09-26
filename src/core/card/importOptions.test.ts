import { describe, expect, it } from 'vitest';
import { blankCard, type AnyCard } from '@/core/card';
import { DEFAULT_IMPORT_OPTIONS, regexScriptsToStLibrary, splitCardAssets } from './importOptions';

function cardWithAssets(): AnyCard {
  const card = blankCard('测试卡');
  const data = card.data as Record<string, unknown>;
  data.character_book = {
    name: '测试书',
    entries: [
      {
        id: 0, keys: ['关键词'], secondary_keys: [], comment: '条目', content: '内容',
        constant: false, selective: false, insertion_order: 100, enabled: true,
        position: 'before_char', use_regex: false,
        extensions: { position: 0, depth: 4, exclude_recursion: true, probability: 100, useProbability: true },
      },
    ],
  };
  data.extensions = {
    regex_scripts: [
      {
        id: 'rx1', scriptName: '脚本一', findRegex: '/a/g', replaceString: 'b', trimStrings: [],
        placement: [2], disabled: false, markdownOnly: false, promptOnly: false,
        runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
      },
    ],
  };
  return card;
}

describe('splitCardAssets 导入拆分（P1-5）', () => {
  it('默认选项：完全不动卡（与既有导入行为一致）', () => {
    const card = cardWithAssets();
    const r = splitCardAssets(card, DEFAULT_IMPORT_OPTIONS);
    const data = r.card.data as Record<string, unknown>;
    expect(data.character_book).toBeDefined();
    expect((data.extensions as Record<string, unknown>).regex_scripts).toBeDefined();
    expect(r.worldbookJson).toBeNull();
    expect(r.regexJson).toBeNull();
  });

  it('世界书拆分：产出 ST 全局世界书 JSON，卡内移除 character_book', () => {
    const r = splitCardAssets(cardWithAssets(), { worldbookMode: 'export', regexMode: 'embed' });
    expect(r.worldbookJson).toContain('"entries"');
    expect(r.worldbookName).toBe('测试书');
    const data = r.card.data as Record<string, unknown>;
    expect(data.character_book).toBeUndefined();
    expect((data.extensions as Record<string, unknown>).regex_scripts).toBeDefined();

    // 产出的 JSON 能被 worldInfoToCharacterBook 读回（roundtrip 由 convert 测试兜底，这里验结构）
    const parsed = JSON.parse(r.worldbookJson!) as { entries: Record<string, { key: string[] }> };
    expect(Object.values(parsed.entries)[0]!.key).toEqual(['关键词']);
  });

  it('正则拆分：产出 ST 脚本库数组 JSON，卡内移除 regex_scripts', () => {
    const r = splitCardAssets(cardWithAssets(), { worldbookMode: 'embed', regexMode: 'export' });
    const arr = JSON.parse(r.regexJson!) as { scriptName: string }[];
    expect(arr).toHaveLength(1);
    expect(arr[0]!.scriptName).toBe('脚本一');
    const data = r.card.data as Record<string, unknown>;
    expect((data.extensions as Record<string, unknown>).regex_scripts).toBeUndefined();
    expect(data.character_book).toBeDefined();
  });

  it('双拆：两者同时产出', () => {
    const r = splitCardAssets(cardWithAssets(), { worldbookMode: 'export', regexMode: 'export' });
    expect(r.worldbookJson).toBeTruthy();
    expect(r.regexJson).toBeTruthy();
  });

  it('regexScriptsToStLibrary：深拷贝输出', () => {
    const scripts = [{ id: 'a', scriptName: 'n', findRegex: '/x/g', replaceString: '', trimStrings: [], placement: [2] as number[], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }];
    const out = regexScriptsToStLibrary(scripts as never);
    expect(out[0]).not.toBe(scripts[0]);
    expect(out[0]!.scriptName).toBe('n');
  });
});
