import { describe, expect, it } from 'vitest';
import type { AnyCard, BookEntry } from '@/core/card';
import { blankCard } from '@/core/card';
import {
  WB_BATCH_SIZE,
  buildBatchSystemPrompt,
  buildBatchUserPrompt,
  isBatchComplete,
  normalizeBatchEntries,
  referenceNovelSegment,
  shuoApplyEntry,
  totalBatches,
  type WorldbookGenParams,
} from './generate';

const params: WorldbookGenParams = {
  worldview: '修仙世界，宗门林立',
  entryTypes: ['system', 'npc', 'location'],
  tierIndex: 1, // 小型 20-35
  style: 'yaml',
  extraRequirement: '避免现代词汇',
};

describe('worldbook generate 批处理纯逻辑', () => {
  it('批数与提前完成阈值', () => {
    expect(totalBatches(35)).toBe(2);
    expect(totalBatches(15)).toBe(1);
    expect(WB_BATCH_SIZE).toBe(30);
  });

  it('isBatchComplete：≥min 且 ≥max×0.8', () => {
    expect(isBatchComplete(19, 20, 35)).toBe(false);
    expect(isBatchComplete(28, 20, 35)).toBe(true);
    expect(isBatchComplete(35, 20, 35)).toBe(true);
  });

  it('system prompt：类型指导 + 中文引号硬规则', () => {
    const sys = buildBatchSystemPrompt(params);
    expect(sys).toContain('修仙世界');
    expect(sys).toContain('系统规则');
    expect(sys).toContain('constant=true');
    expect(sys).toContain('中文引号');
    expect(sys).toContain('避免现代词汇');
    expect(sys).toContain('YAML 结构化'.slice(0, 4));
  });

  it('user prompt：第二批带已生成名单防重复 + 参考小说段', () => {
    const user1 = buildBatchUserPrompt(params, [], 0, 35);
    expect(user1).toContain('第 1 批');
    const user2 = buildBatchUserPrompt(params, ['青风城', '玄阳宗'], 1, 35, '小说原文……');
    expect(user2).toContain('不要重复');
    expect(user2).toContain('青风城、玄阳宗');
    expect(user2).toContain('参考小说素材');
    expect(referenceNovelSegment('')).toBe('');
  });

  it('normalizeBatchEntries：空对象过滤、重名丢弃、整批空检测', () => {
    const names = new Set<string>();
    const { entries, allEmpty } = normalizeBatchEntries(
      [
        { comment: '青风城', keys: ['青风城'], content: '城池', constant: false },
        {}, // 空对象
        { comment: '青风城', keys: [], content: '重复' }, // 重名丢弃
        null,
      ],
      names,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.comment).toBe('青风城');
    expect(allEmpty).toBe(false);
    expect(names.has('青风城')).toBe(true);

    const empty = normalizeBatchEntries([{}, {}, {}], new Set());
    expect(empty.entries).toHaveLength(0);
    expect(empty.allEmpty).toBe(true);

    // 非数组（截断）也按空批处理
    expect(normalizeBatchEntries('oops', new Set()).allEmpty).toBe(true);
  });

  it('朔规则落卡：order=100、蓝绿灯递归配置、position 映射', () => {
    const blue = shuoApplyEntry({ comment: '共享背景', keys: [], secondary_keys: [], content: 'x', constant: true, insertion_order: 5, enabled: true }, 7);
    expect(blue.id).toBe(7);
    expect(blue.insertion_order).toBe(100);
    expect(blue.position).toBe('before_char');
    expect(blue.extensions.position).toBe(0);
    expect(blue.extensions.exclude_recursion).toBe(true);
    expect(blue.extensions.prevent_recursion).toBe(false);

    const green = shuoApplyEntry({ comment: '配角', keys: ['配角'], secondary_keys: [], content: 'y', constant: false, insertion_order: 60, enabled: true }, 8);
    expect(green.position).toBe('after_char');
    expect(green.extensions.position).toBe(1);
    expect(green.extensions.prevent_recursion).toBe(true);
    expect(green.extensions.exclude_recursion).toBe(true);
  });

  it('shuoApplyEntry 可在真实卡上组装为合法 BookEntry', () => {
    const card: AnyCard = blankCard('t');
    const data = card.data as Record<string, unknown>;
    const book = (data.character_book ?? { name: '', entries: [] }) as { name?: string; entries: unknown[] };
    book.entries.push(shuoApplyEntry({ comment: 'c', keys: ['k'], secondary_keys: [], content: 'x', constant: false, insertion_order: 100, enabled: true }, 0));
    data.character_book = book;
    expect(book.entries).toHaveLength(1);
  });
});

/* ---------------- 批量注入性能基线（ROADMAP §三.3） ---------------- */

describe('批量注入性能基线（极限目标 500 条）', () => {
  it('500 条全量朔规则注入（含响应式消毒深拷贝）在基线时间内完成', () => {
    // 与 WbBatchPanel.inject 同构的注入路径：JSON 深拷贝既有书（对齐工坊「响应式消毒」约定）
    // → 逐条 shuoApplyEntry → 追加。基线预算 2s，用于捕获 O(n²) 退化而非精确计时。
    const existing: BookEntry[] = [];
    for (let i = 0; i < 200; i++) {
      existing.push(shuoApplyEntry({ comment: `旧条目${i}`, keys: [`旧${i}`], secondary_keys: [], content: '既有内容'.repeat(50), constant: false, insertion_order: 100, enabled: true }, i));
    }
    const raws = [];
    for (let i = 0; i < 500; i++) {
      raws.push({ comment: `条目${i}`, keys: [`关键词${i}`], secondary_keys: [], content: '生成内容'.repeat(100), constant: i % 5 === 0, insertion_order: 100, enabled: true });
    }
    const t0 = performance.now();
    const next = JSON.parse(JSON.stringify(existing)) as BookEntry[];
    const entries = raws.map((e, i) => shuoApplyEntry(e, next.length + i));
    next.push(...entries);
    const elapsed = performance.now() - t0;
    expect(next).toHaveLength(700);
    expect(entries[0]!.comment).toBe('条目0');
    expect(elapsed).toBeLessThan(2000);
  });
});
