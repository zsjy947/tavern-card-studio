/** 服务层集成测试（MemoryStore） */
import { describe, it, expect, beforeEach } from 'vitest';
import { setStore } from '@/db';
import { MemoryStore } from '@/db/drivers';

// 全部服务走内存库
setStore(new MemoryStore());

import * as cardService from '@/services/cardService';
import { parseLooseCard, dataHash } from '@/core/card';
import { insertStatusbar, renderStatusbarHtml, normalizeImageLink, buildStatusbarRegex } from '@/services/beautifyService';
import { SIMPLE_STATUSBAR, simpleStatusbarPayload } from './fixtures/statusbar';
import { exportBackup, importBackup } from '@/services/backupService';
import { ensureSeeded, listTemplates } from '@/services/templateService';
import { staticDiagnose } from '@/services/diagService';

const V3 = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '服务层测试卡',
    description: '描述',
    first_mes: '开场',
    tags: ['t1'],
  },
};

describe('cardService', () => {
  it('导入 → 建行 + 初始快照', async () => {
    const { row } = await cardService.importCardFromJson(V3);
    expect(row.name).toBe('服务层测试卡');
    expect(row.dataHash).toBe(dataHash(parseLooseCard(V3).data));
    const versions = await cardService.listVersions(row.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.note).toBe('导入');
  });

  it('同 hash 二次导入覆盖而非重复', async () => {
    const first = await cardService.importCardFromJson(V3);
    const second = await cardService.importCardFromJson(JSON.parse(JSON.stringify(V3)));
    expect(second.replacedName).toBe('服务层测试卡');
    expect(second.row.id).toBe(first.row.id);
    const all = await cardService.listCards();
    expect(all.filter((c) => c.dataHash === first.row.dataHash)).toHaveLength(1);
  });

  it('保存自动快照 + 回滚', async () => {
    // 独立内容（避免与其他用例的同 hash 覆盖串版本计数）
    const { row } = await cardService.importCardFromJson({ spec: 'chara_card_v3', data: { name: '快照专用卡', description: '描述 v1', first_mes: 'x' } });
    const card = JSON.parse(JSON.stringify(row.card));
    card.data.description = '修改后的描述';
    await cardService.saveCard(row.id, card, { note: '改描述' });
    const versions = await cardService.listVersions(row.id);
    expect(versions).toHaveLength(2);

    const after = await cardService.getCard(row.id);
    expect(after!.card.data.description).toBe('修改后的描述');

    const v1 = versions.find((v) => v.versionNo === 1)!;
    const rolled = await cardService.rollbackToVersion(row.id, v1.id);
    expect(rolled.card.data.description).toBe('描述 v1');
    // 回滚本身也存快照
    expect(await cardService.listVersions(row.id)).toHaveLength(3);
  });

  it('软删除/恢复/彻底删除', async () => {
    const { row } = await cardService.importCardFromJson({ spec: 'chara_card_v3', data: { name: '回收站卡', description: 'x' } });
    await cardService.trashCard(row.id);
    expect((await cardService.listCards(false)).find((c) => c.id === row.id)).toBeUndefined();
    expect((await cardService.listCards(true)).find((c) => c.id === row.id)).toBeDefined();
    await cardService.restoreCard(row.id);
    expect((await cardService.listCards(false)).find((c) => c.id === row.id)).toBeDefined();
    await cardService.hardDeleteCard(row.id);
    expect((await cardService.listCards(true)).find((c) => c.id === row.id)).toBeUndefined();
  });

  it('diff 检出字段变化', async () => {
    const a = parseLooseCard(V3);
    const b = parseLooseCard({ ...V3, data: { ...V3.data, description: '新描述', personality: '新增性格' } });
    const diff = cardService.diffCards(a, b);
    expect(diff.find((d) => d.field === 'description')?.kind).toBe('changed');
    expect(diff.find((d) => d.field === 'personality')?.kind).toBe('added');
  });

  it('PNG 导出可再导入（roundtrip）', async () => {
    const { row } = await cardService.importCardFromJson(V3);
    const png = await cardService.cardToPngBytes(row.card, null, { dualWrite: true });
    const back = await cardService.importCardFromPng(png);
    expect(back.row.card.data.description).toBe('描述');
    expect(back.row.cover).toMatch(/^data:image\/png;base64,/);
  });
});

describe('beautifyService 三件套', () => {
  it('一键插入：tag + 正则 + 世界书', async () => {
    const card = parseLooseCard(V3);
    const { card: next, inserted } = insertStatusbar(card, simpleStatusbarPayload, { charName: '服务层测试卡' });
    expect(inserted.tag).toBe(true);
    expect(next.data.first_mes).toContain(simpleStatusbarPayload.tag);
    const scripts = (next.data as { extensions: { regex_scripts?: unknown[] } }).extensions.regex_scripts!;
    expect(scripts).toHaveLength(1);
    const book = (next.data as { character_book?: { entries: unknown[] } }).character_book;
    expect(book?.entries).toHaveLength(1);
    // 原卡不被修改
    expect(card.data.first_mes).not.toContain(simpleStatusbarPayload.tag);
  });

  it('重复插入不叠加（幂等）', () => {
    const card = parseLooseCard(V3);
    const once = insertStatusbar(card, simpleStatusbarPayload, {}).card;
    const twice = insertStatusbar(once, simpleStatusbarPayload, {});
    const scripts = (twice.card.data as { extensions: { regex_scripts?: unknown[] } }).extensions.regex_scripts!;
    expect(scripts).toHaveLength(1);
    expect((twice.card.data as { character_book?: { entries: unknown[] } }).character_book?.entries).toHaveLength(1);
    expect(twice.card.data.first_mes.match(new RegExp(simpleStatusbarPayload.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
  });

  it('渲染 HTML 变量替换', () => {
    const html = renderStatusbarHtml(simpleStatusbarPayload, { favor: '99' }, '小雪');
    expect(html).toContain('99');
    expect(html).toContain('小雪');
    expect(html).not.toContain('{{getvar::favor}}');
  });

  it('外链规范化：本地路径 → file://，data URL 警告', () => {
    expect(normalizeImageLink('D:\\pics\\a.png')).toEqual({ kind: 'file', normalized: 'file:///D:/pics/a.png' });
    expect(normalizeImageLink('https://img.example.com/a.png').kind).toBe('http');
    expect(normalizeImageLink('data:image/png;base64,xxx').warning).toBeTruthy();
  });
});

describe('备份', () => {
  it('导出 → 清空恢复 → 数据一致', async () => {
    await cardService.importCardFromJson(V3);
    const blob = await exportBackup();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { tables } = await importBackup(bytes, { wipe: true });
    expect(tables.cards).toBeGreaterThan(0);
    const cards = await cardService.listCards(true);
    expect(cards.length).toBe(tables.cards);
  });
});

describe('模板播种', () => {
  it('内置模板齐全（card/statusbar/regex/prompt）', async () => {
    await ensureSeeded();
    const all = await listTemplates();
    for (const kind of ['card', 'statusbar', 'regex', 'prompt'] as const) {
      expect(all.filter((t) => t.kind === kind).length).toBeGreaterThanOrEqual(3);
    }
    expect(all.filter((t) => t.kind === 'card')).toHaveLength(5);
  });
});

describe('诊断服务', () => {
  it('静态诊断透传 core', async () => {
    const issues = staticDiagnose(parseLooseCard(V3));
    expect(Array.isArray(issues)).toBe(true);
  });
});
