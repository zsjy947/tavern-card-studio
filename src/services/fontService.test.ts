/** fontService：目录安装 / zip 解包 / 本地导入 / 卸载（MemoryStore + mock fetch） */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import { MemoryStore } from '@/db/drivers';
import { setStore } from '@/db';
import { FONT_CATALOG } from '@/core/font';
import {
  listInstalled, downloadCatalogFont, importLocalFont, removeFont, ensureFontLoaded,
  extractFontFromArchive, isFontReady, fontExtFromBytes,
} from './fontService';

/** 构造一个假 TTF（头部魔数 + 足够长度的填充） */
function fakeFontBytes(magic = '00010000'): Uint8Array {
  const head = [...magic].map((c) => c.charCodeAt(0));
  const pad = new Uint8Array(2048).fill(0x42);
  return new Uint8Array([...head, ...pad]);
}

beforeEach(() => {
  setStore(new MemoryStore());
  vi.unstubAllGlobals();
});

describe('extractFontFromArchive', () => {
  it('优先提取 Regular 字重', async () => {
    const zip = new JSZip();
    zip.file('ZhuqueFangsong-v0.212/readme.txt', 'doc');
    zip.file('ZhuqueFangsong-v0.212/ZhuqueFangsong-Bold.ttf', new Uint8Array([1, 2]));
    zip.file('ZhuqueFangsong-v0.212/ZhuqueFangsong-Regular.ttf', fakeFontBytes());
    const blob = await zip.generateAsync({ type: 'uint8array' });
    const out = await extractFontFromArchive(blob);
    expect(out.length).toBeGreaterThan(1000);
  });

  it('无 Regular 时取第一个字体文件；无字体则报错', async () => {
    const zip = new JSZip();
    zip.file('note.txt', 'no fonts here');
    const noFont = await zip.generateAsync({ type: 'uint8array' });
    await expect(extractFontFromArchive(noFont)).rejects.toThrow('未找到字体');

    const zip2 = new JSZip();
    zip2.file('some.ttf', fakeFontBytes());
    const withFont = await zip2.generateAsync({ type: 'uint8array' });
    const out = await extractFontFromArchive(withFont);
    expect(out.length).toBeGreaterThan(1000);
  });
});

describe('downloadCatalogFont', () => {
  it('下载 → 解包 → 持久化（zip 型条目）', async () => {
    const zip = new JSZip();
    zip.file('ZhuqueFangsong-Regular.ttf', fakeFontBytes());
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(zipBytes), {
      status: 200,
      headers: { 'content-length': String(zipBytes.length) },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const entry = FONT_CATALOG.find((f) => f.id === 'zhuque-fangsong')!;
    const progresses: [number, number][] = [];
    const meta = await downloadCatalogFont(entry, (loaded, total) => progresses.push([loaded, total]));

    expect(meta.id).toBe('zhuque-fangsong');
    expect(meta.family).toBe('Zhuque Fangsong');
    expect(meta.size).toBeGreaterThan(1000);
    expect(meta.source).toBe('catalog');
    expect(progresses.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 第一源成功即止

    const all = await listInstalled();
    expect(all.map((f) => f.id)).toContain('zhuque-fangsong');
  });

  it('首个源失败时回退镜像', async () => {
    const bytes = fakeFontBytes();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const entry = FONT_CATALOG.find((f) => f.id === 'yozai')!;
    const meta = await downloadCatalogFont(entry);
    expect(meta.name).toBe('悠哉字体');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('全部源失败时抛错且不写库', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const entry = FONT_CATALOG.find((f) => f.id === 'lxgw-wenkai')!;
    await expect(downloadCatalogFont(entry)).rejects.toThrow('下载失败');
    expect(await listInstalled()).toHaveLength(0);
  });
});

describe('fontExtFromBytes 魔数嗅探', () => {
  const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  it('识别 wOF2/wOFF/OTTO，其余按 ttf', () => {
    expect(fontExtFromBytes(enc('wOF2xxxx'))).toBe('.woff2');
    expect(fontExtFromBytes(enc('wOFFxxxx'))).toBe('.woff');
    expect(fontExtFromBytes(enc('OTTOxxxx'))).toBe('.otf');
    expect(fontExtFromBytes(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00]))).toBe('.ttf');
    expect(fontExtFromBytes(new Uint8Array(4))).toBe('.ttf');
  });
});

describe('本地导入与卸载', () => {
  it('importLocalFont 持久化元信息与字节，fileName 由嗅探生成', async () => {
    const file = new File([fakeFontBytes()], '我的字体.ttf', { type: 'font/ttf' });
    const meta = await importLocalFont(file);
    expect(meta.family).toBe('我的字体');
    expect(meta.source).toBe('local');
    expect(meta.fileName).toBe(`${meta.id}.ttf`);
    expect(meta.size).toBeGreaterThan(1000);
    const all = await listInstalled();
    expect(all).toHaveLength(1);
  });

  it('removeFont 清除两张表；ensureFontLoaded 对缺失 id 返回 false', async () => {
    const file = new File([fakeFontBytes()], 'demo.otf', { type: 'font/otf' });
    const meta = await importLocalFont(file);
    // Node 环境无 FontFace，注册静默跳过但不报错
    expect(isFontReady(meta.id)).toBe(false);
    expect(await ensureFontLoaded(meta.id)).toBe(false);
    await removeFont(meta.id);
    expect(await listInstalled()).toHaveLength(0);
    expect(await ensureFontLoaded(meta.id)).toBe(false);
  });
});
