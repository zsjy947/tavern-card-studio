import { describe, it, expect } from 'vitest';
import { splitChapters, isChapterHeading, extractTextFromXhtml, parseEpub, scanCharacterNames, collectContext } from './source';
import JSZip from 'jszip';

const NOVEL = `书名页信息
作者：某人

第一章 初见
林晚走进图书馆，看见沈舟正在整理书架。
"这本书给你。"沈舟说。

第二章 误会
林晚误会了沈舟的意思，转身离开。
沈舟追了出去，在雨里解释了很久。

第3章 数字章节
两人和好，一起去吃了面。

尾声
故事结束。`;

describe('章节切分', () => {
  it('识别中文章节头', () => {
    expect(isChapterHeading('第一章 初见')).toBe(true);
    expect(isChapterHeading('第123章 大战')).toBe(true);
    expect(isChapterHeading('第3章 数字章节')).toBe(true);
    expect(isChapterHeading('楔子')).toBe(true);
    expect(isChapterHeading('尾声')).toBe(true);
    expect(isChapterHeading('番外：婚礼')).toBe(true);
    expect(isChapterHeading('这是普通对话')).toBe(false);
  });

  it('切分出章节并保留题头', () => {
    const chapters = splitChapters(NOVEL);
    expect(chapters.map((c) => c.title)).toEqual(['开篇', '第一章 初见', '第二章 误会', '第3章 数字章节', '尾声']);
    expect(chapters[1]!.content).toContain('林晚走进图书馆');
    expect(chapters[4]!.content).toContain('故事结束');
  });

  it('无章节头时按长度均分', () => {
    const text = '字'.repeat(5000) + '\n' + '词'.repeat(5000);
    const chapters = splitChapters(text, { fallbackChunkChars: 4000 });
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters.reduce((a, c) => a + c.content.length, 0)).toBeGreaterThan(9000);
  });
});

describe('xhtml 正文提取', () => {
  it('段落与标题转换', () => {
    const out = extractTextFromXhtml(`<html><head><title>t</title></head><body>
      <h1>第一章</h1><p>第一段&nbsp;文本</p><p>第二&lt;段&gt;</p><br/>
      </body></html>`);
    expect(out).toContain('第一章');
    expect(out).toContain('第一段 文本');
    expect(out).toContain('第二<段>');
    expect(out).not.toContain('<p>');
  });
});

describe('epub 解析', () => {
  async function buildEpub(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', `<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`);
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试之书</dc:title></metadata>
        <manifest>
          <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
      </package>`);
    zip.file('OEBPS/chap1.xhtml', `<html><body><h1>第一章</h1><p>林晚睁开了眼。</p><p>这里是 epub。</p></body></html>`);
    zip.file('OEBPS/chap2.xhtml', `<html><body><h1>第二章</h1><p>沈舟出现了。</p></body></html>`);
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('spine 顺序解包', async () => {
    const epub = await parseEpub(await buildEpub());
    expect(epub.title).toBe('测试之书');
    expect(epub.chapters).toHaveLength(2);
    expect(epub.chapters[0]!.title).toBe('第一章');
    expect(epub.chapters[0]!.content).toContain('林晚睁开了眼。');
    expect(epub.chapters[1]!.content).toContain('沈舟出现了。');
  });
});

describe('候选角色扫描', () => {
  it('高频名词浮出', () => {
    const text = ('林晚说了一句话。沈舟看着林晚。林晚和沈舟一起走。' + '路人甲路过。').repeat(3);
    const names = scanCharacterNames(text, 10);
    expect(names[0]!.name).toBe('林晚');
    expect(names.map((n) => n.name)).toContain('沈舟');
  });

  it('停用词被过滤', () => {
    const names = scanCharacterNames('他们来了。我们知道什么。'.repeat(5), 20);
    expect(names.map((n) => n.name)).not.toContain('他们');
  });
});

describe('上下文检索', () => {
  const chapters = splitChapters(NOVEL);

  it('命中段落收集', () => {
    const { text, hits } = collectContext(chapters, ['沈舟']);
    expect(hits).toBeGreaterThan(0);
    expect(text).toContain('沈舟');
  });

  it('超限等距采样压缩', () => {
    const long = chapters.map((c) => ({ ...c, content: c.content + ('沈舟说了很多话。'.repeat(200)) }));
    const { text } = collectContext(long, ['沈舟'], { maxChars: 2000, perChapterMax: 800 });
    expect(text.length).toBeLessThanOrEqual(2200);
  });

  it('无命中返回空', () => {
    const { text, hits } = collectContext(chapters, ['不存在的人']);
    expect(hits).toBe(0);
  });
});
