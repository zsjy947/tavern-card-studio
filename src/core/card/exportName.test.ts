import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_TEMPLATE, renderExportFilename, todayDate } from './exportName';

const ctx = { name: '林晚', spec: 'v3', version: '1.2', date: '2026-09-27' };

describe('renderExportFilename', () => {
  it('默认模板 {name}_{date}', () => {
    expect(renderExportFilename(DEFAULT_EXPORT_TEMPLATE, ctx)).toBe('林晚_2026-09-27');
    expect(renderExportFilename('', ctx)).toBe('林晚_2026-09-27');
  });

  it('占位符组合', () => {
    expect(renderExportFilename('{name}_{spec}_{version}', ctx)).toBe('林晚_v3_1.2');
    expect(renderExportFilename('[{spec}] {name} ({version})', ctx)).toBe('[v3] 林晚 (1.2)');
  });

  it('空名回退 untitled；version 缺省 none；date 缺省当天', () => {
    expect(renderExportFilename('{name}', { ...ctx, name: '  ' })).toBe('untitled');
    expect(renderExportFilename('{version}', { ...ctx, version: '' })).toBe('none');
    expect(renderExportFilename('{date}', { ...ctx, date: undefined })).toBe(todayDate());
  });

  it('未知占位符原样保留（可自查）；路径分隔转下划线', () => {
    expect(renderExportFilename('{name}/{unknown}', ctx)).toBe('林晚_{unknown}');
    expect(renderExportFilename('{name}\\{date}', ctx)).toBe('林晚_2026-09-27');
  });

  it('超长名截断', () => {
    const longName = '名'.repeat(300);
    const out = renderExportFilename('{name}', { ...ctx, name: longName });
    expect(out.length).toBeLessThanOrEqual(120);
  });
});
