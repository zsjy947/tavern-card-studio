import { describe, it, expect } from 'vitest';
import { dataUrlToBytes } from './image';
import { bytesToBase64 } from './file';

describe('dataUrlToBytes', () => {
  it('解析 PNG data URL 并与原字节一致', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const url = `data:image/png;base64,${bytesToBase64(bytes)}`;
    const out = dataUrlToBytes(url);
    expect(out).not.toBeNull();
    expect([...out!]).toEqual([...bytes]);
  });
  it('非 base64 data URL / 普通文本返回 null', () => {
    expect(dataUrlToBytes('data:image/png,rawdata')).toBeNull();
    expect(dataUrlToBytes('https://example.com/a.png')).toBeNull();
    expect(dataUrlToBytes(null)).toBeNull();
    expect(dataUrlToBytes(undefined)).toBeNull();
    expect(dataUrlToBytes('')).toBeNull();
  });
  it('容忍 multipart 边界字符（/s 修饰）', () => {
    const bytes = new Uint8Array([10, 13, 26, 255, 0]);
    const url = `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
    expect([...dataUrlToBytes(url)!]).toEqual([...bytes]);
  });
});
