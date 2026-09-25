/**
 * 真实社区卡导入回归（迭代三 #2/#5/#6 回归基线，计划 §12）。
 * 样本目录不存在时整组跳过（样本不进仓库，路径按本机配置）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLooseCard } from '@/core/card';
import { extractCardFromPng } from '@/core/png';
import { runStaticChecks } from '@/core/diag/staticChecks';
import { insertStatusbar, renderStatusbarHtml } from '@/services/beautifyService';
import { builtinStatusbarTemplates, type StatusbarPayload } from '@/builtins/statusbarTemplates';

const SAMPLE_DIR = 'D:/AAA_files/downloads/SillyTavern/角色卡/discord类脑';
const hasSamples = existsSync(SAMPLE_DIR);

/** 与 CharacterMembersTab 一致的角色条目启发式（若组件逻辑变化请同步） */
function isCharacterEntry(e: { content?: string; constant?: boolean; keys?: string[]; comment?: string }): boolean {
  if (/(^|\n)\s*(name|姓名)\s*:/.test(e.content ?? '')) return true;
  return Boolean(e.constant && (e.keys?.length ?? 0) === 0 && e.comment && (e.content ?? '').includes('\n'));
}

describe.skipIf(!hasSamples)('真实社区卡导入回归（discord类脑 13 卡）', () => {
  const files = readdirSync(SAMPLE_DIR).filter((f) => /\.(png|json)$/i.test(f));
  const pngs = files.filter((f) => f.endsWith('.png'));
  const jsons = files.filter((f) => f.endsWith('.json'));

  it(`样本齐全（PNG ${pngs.length} 张 + JSON ${jsons.length} 个）`, () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  it('全部 PNG 卡：tEXt 抽取 → 归一化 → 静态诊断，全程不抛错', () => {
    expect(pngs.length).toBeGreaterThan(0);
    for (const f of pngs) {
      const bytes = new Uint8Array(readFileSync(join(SAMPLE_DIR, f)));
      const { raw } = extractCardFromPng(bytes);
      const card = parseLooseCard(raw);
      expect(card.data.name).toBeTruthy();
      expect(['chara_card_v2', 'chara_card_v3'].includes(card.spec) || card.spec === 'chara_card_v1').toBe(true);
      expect(() => runStaticChecks(card)).not.toThrow();
    }
  });

  it('全部 JSON 卡：归一化 + 诊断不抛错', () => {
    expect(jsons.length).toBeGreaterThan(0);
    for (const f of jsons) {
      const card = parseLooseCard(JSON.parse(readFileSync(join(SAMPLE_DIR, f), 'utf8')));
      expect(card.data.name).toBeTruthy();
      expect(() => runStaticChecks(card)).not.toThrow();
    }
  });

  it('多卡带 character_book：世界书条目可解析，角色成员启发式能识别条目', () => {
    let bookCards = 0;
    let recognized = 0;
    let totalEntries = 0;
    for (const f of files) {
      const raw = f.endsWith('.png')
        ? extractCardFromPng(new Uint8Array(readFileSync(join(SAMPLE_DIR, f)))).raw
        : JSON.parse(readFileSync(join(SAMPLE_DIR, f), 'utf8'));
      const card = parseLooseCard(raw);
      const book = (card.data as { character_book?: { entries?: unknown[] } }).character_book;
      const entries = book?.entries ?? [];
      if (!entries.length) continue;
      bookCards++;
      totalEntries += entries.length;
      for (const e of entries) {
        const entry = e as { content?: string; constant?: boolean; keys?: string[]; comment?: string };
        expect(typeof entry.content).toBe('string');
        if (isCharacterEntry(entry)) recognized++;
      }
    }
    expect(bookCards).toBeGreaterThan(0);
    // 启发式不应把所有条目都当角色（世界书还有世界观/机制条目），也应至少识别出部分成员条目
    expect(recognized).toBeGreaterThan(0);
    expect(recognized).toBeLessThanOrEqual(totalEntries);
  });

  it('美化三件套插入真实卡：占位/正则/世界书齐全，产物可再次归一化', () => {
    const ensemble = builtinStatusbarTemplates().find((t) => t.id === 'tpl-sb-ensemble')!;
    const payload = ensemble.payload as StatusbarPayload;
    let inserted = 0;
    for (const f of files) {
      const raw = f.endsWith('.png')
        ? extractCardFromPng(new Uint8Array(readFileSync(join(SAMPLE_DIR, f)))).raw
        : JSON.parse(readFileSync(join(SAMPLE_DIR, f), 'utf8'));
      const card = parseLooseCard(raw);
      const { card: next } = insertStatusbar(card, payload, { charName: card.data.name });
      // 产物必须是合法卡（再次归一化不抛错）
      const reparsed = parseLooseCard(JSON.parse(JSON.stringify(next)));
      const d = reparsed.data as { first_mes?: string; extensions?: { regex_scripts?: { findRegex: string }[] }; character_book?: { entries: { content: string }[] } };
      expect(d.first_mes).toContain(payload.tag);
      // 同一 tag 的渲染脚本恰好一条（真实卡自带的其他正则不受影响）
      const ours = (d.extensions?.regex_scripts ?? []).filter((s) => s.findRegex.includes(payload.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      expect(ours.length).toBe(1);
      expect(d.character_book?.entries.some((e) => e.content.includes('群像') || e.content.includes('状态栏变量'))).toBe(true);
      // 渲染链路不抛错
      expect(() => renderStatusbarHtml(payload, {}, card.data.name)).not.toThrow();
      inserted++;
    }
    expect(inserted).toBe(files.length);
  });
});
