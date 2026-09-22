import { describe, it, expect } from 'vitest';
import {
  parsePng, buildPng, encodeTextChunk, decodeTextChunk, crc32,
  injectCardIntoPng, extractCardFromPng, makePlaceholderPng, PngFormatError,
} from './codec';

function tinyPng(): Uint8Array {
  return makePlaceholderPng(4, [90, 60, 200]);
}

describe('crc32', () => {
  it('已知向量', () => {
    expect(crc32(new Uint8Array([]))).toBe(0);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('tEXt 编解码', () => {
  it('中文往返', () => {
    const data = encodeTextChunk('chara', '你好，世界{{char}}');
    const { keyword, text } = decodeTextChunk(data);
    expect(keyword).toBe('chara');
    expect(text).toBe('你好，世界{{char}}');
  });
});

describe('PNG 解析/打包往返', () => {
  it('chunk 往返保持一致', () => {
    const png = tinyPng();
    const chunks = parsePng(png);
    expect(chunks[0]?.name).toBe('IHDR');
    expect(chunks.at(-1)?.name).toBe('IEND');
    const rebuilt = buildPng(chunks);
    expect([...rebuilt]).toEqual([...png]);
  });

  it('非 PNG 报错', () => {
    expect(() => parsePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(PngFormatError);
  });
});

describe('卡片注入/抽取', () => {
  const cardJson = JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: '测试角色', description: '描述「含中文引号」与\n换行', tags: ['中文', 'test'] },
  });

  it('默认双写 ccv3 + chara，抽取优先 ccv3', () => {
    const png = injectCardIntoPng(tinyPng(), cardJson);
    const out = extractCardFromPng(png);
    expect(out.source).toBe('ccv3');
    expect((out.raw as { data: { name: string } }).data.name).toBe('测试角色');
  });

  it('单写 chara 也能抽取（V2 卡场景）', () => {
    const png = injectCardIntoPng(tinyPng(), cardJson, { dualWrite: false });
    const out = extractCardFromPng(png);
    expect(out.source).toBe('chara');
  });

  it('二次注入替换旧元数据（不累积）', () => {
    const once = injectCardIntoPng(tinyPng(), cardJson);
    const twice = injectCardIntoPng(once, JSON.stringify({ spec: 'chara_card_v2', data: { name: 'v2 卡' } }));
    const out = extractCardFromPng(twice);
    expect((out.raw as { data: { name: string } }).data.name).toBe('v2 卡');
    // 只剩 ccv3 + chara 两个卡片块
    const chunks = parsePng(twice).filter((c) => c.name === 'tEXt');
    const cardChunks = chunks.filter((c) => {
      const z = c.data.indexOf(0);
      const kw = String.fromCharCode(...c.data.subarray(0, z)).toLowerCase();
      return kw === 'ccv3' || kw === 'chara';
    });
    expect(cardChunks.length).toBe(2);
  });

  it('无元数据时明确报错', () => {
    expect(() => extractCardFromPng(tinyPng())).toThrow(/没有角色卡元数据/);
  });

  it('注入后 PNG 仍是合法图片（IHDR 在前、IEND 在尾）', () => {
    const png = injectCardIntoPng(tinyPng(), cardJson);
    const chunks = parsePng(png);
    expect(chunks[0]?.name).toBe('IHDR');
    expect(chunks.at(-1)?.name).toBe('IEND');
  });
});
