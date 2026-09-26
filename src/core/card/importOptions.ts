/**
 * 导入预设选项（ROADMAP P1-5）：导入时的世界书/正则拆分选项（纯函数）。
 * - 世界书：保持内嵌（默认）/ 拆为 ST 全局世界书 JSON（复用 characterBookToWorldInfo，ST 专属字段在 extensions 双向保留不丢失）
 * - 正则：随卡（默认）/ 导出独立脚本 JSON（ST 脚本库数组格式）
 * 默认行为（不拆）与既有导入完全一致。
 */
import type { AnyCard, RegexScript } from '../card/schema';
import { characterBookToWorldInfo } from '../lorebook/convert';

export interface ImportSplitOptions {
  worldbookMode: 'embed' | 'export';
  regexMode: 'embed' | 'export';
}

export const DEFAULT_IMPORT_OPTIONS: ImportSplitOptions = { worldbookMode: 'embed', regexMode: 'embed' };

export interface SplitResult {
  /** 处理后的卡（拆分模式下已移除对应资产） */
  card: AnyCard;
  /** ST 全局世界书 JSON（未拆分为 null） */
  worldbookJson: string | null;
  /** 世界书名称（文件名用） */
  worldbookName: string | null;
  /** ST 正则脚本库 JSON（未拆分为 null） */
  regexJson: string | null;
}

/** 正则脚本 → ST 脚本库数组（社区惯例的导入格式：正则脚本对象数组） */
export function regexScriptsToStLibrary(scripts: RegexScript[]): RegexScript[] {
  return scripts.map((s) => JSON.parse(JSON.stringify(s)) as RegexScript);
}

/** 按选项拆分卡内资产；embed 模式原样返回（worldbookJson/regexJson 为 null） */
export function splitCardAssets(card: AnyCard, opts: ImportSplitOptions): SplitResult {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  const ext = (data.extensions ?? {}) as Record<string, unknown>;
  let worldbookJson: string | null = null;
  let worldbookName: string | null = null;
  let regexJson: string | null = null;

  if (opts.worldbookMode === 'export') {
    const book = data.character_book as { name?: string; entries: unknown[] } | undefined;
    if (book?.entries?.length) {
      const wi = characterBookToWorldInfo(book as never);
      worldbookJson = JSON.stringify({ entries: wi.entries, name: book.name ?? data.name ?? '世界书' }, null, 2);
      worldbookName = book.name || String(data.name ?? '世界书');
      delete data.character_book;
    }
  }

  if (opts.regexMode === 'export') {
    const scripts = (ext.regex_scripts as RegexScript[] | undefined) ?? [];
    if (scripts.length) {
      regexJson = JSON.stringify(regexScriptsToStLibrary(scripts), null, 2);
      delete ext.regex_scripts;
      data.extensions = ext;
    }
  }

  return { card: next, worldbookJson, worldbookName, regexJson };
}
