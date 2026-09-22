/**
 * 静态检查（本地即时，无需 AI）：
 * schema 校验、字段缺失、token 超限、世界书键冲突、正则语法错误、嵌图体积。
 */

import type { AnyCard } from '../card/schema';
import { SPEC_V2, SPEC_V3 } from '../card/schema';
import { compileFindRegex } from '../regex/model';
import { countTokens } from '../stats/tokens';

export type DiagSeverity = 'error' | 'warn' | 'info';

export interface DiagIssue {
  field: string;
  severity: DiagSeverity;
  message: string;
  /** 修复建议 */
  suggestion?: string;
}

export interface DiagThresholds {
  /** 单字段 token 上限 */
  fieldTokens?: number;
  descriptionTokens?: number;
  firstMesTokens?: number;
  /** 嵌入图片总体积上限（KB，对 base64 data URL 累计） */
  embeddedImageKb?: number;
}

export const DEFAULT_THRESHOLDS: DiagThresholds = {
  fieldTokens: 2000,
  descriptionTokens: 4000,
  firstMesTokens: 2000,
  embeddedImageKb: 2048,
};

export function runStaticChecks(card: AnyCard, thresholds: DiagThresholds = DEFAULT_THRESHOLDS): DiagIssue[] {
  const issues: DiagIssue[] = [];
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const d = card.data as Record<string, unknown>;

  /* ---- 基础结构 ---- */
  const specName = card.spec as string;
  if (specName !== SPEC_V2 && specName !== SPEC_V3) {
    issues.push({ field: 'spec', severity: 'warn', message: `非标准 spec：${specName}，建议迁移到 V3`, suggestion: '编辑器 → 扩展 → 规格转换' });
  }
  if (!String(d.name ?? '').trim()) issues.push({ field: 'name', severity: 'error', message: '缺少角色名' });

  /* ---- 关键字段缺失 ---- */
  if (!String(d.description ?? '').trim()) {
    issues.push({ field: 'description', severity: 'error', message: '缺少角色描述（description 为空）' });
  }
  if (!String(d.first_mes ?? '').trim() && !(Array.isArray(d.alternate_greetings) && d.alternate_greetings.length)) {
    issues.push({ field: 'first_mes', severity: 'error', message: '缺少开场白（first_mes 与 alternate_greetings 均为空）' });
  }
  if (!String(d.personality ?? '').trim()) {
    issues.push({ field: 'personality', severity: 'info', message: '性格字段为空（可考虑补充，或在描述中已涵盖）' });
  }
  if (!String(d.scenario ?? '').trim()) {
    issues.push({ field: 'scenario', severity: 'info', message: '场景字段为空' });
  }
  if (!String(d.mes_example ?? '').trim()) {
    issues.push({ field: 'mes_example', severity: 'info', message: '对话示例为空（有助于稳定口吻）' });
  }

  /* ---- token 超限 ---- */
  const fields: [string, string][] = [
    ['description', String(d.description ?? '')],
    ['personality', String(d.personality ?? '')],
    ['scenario', String(d.scenario ?? '')],
    ['first_mes', String(d.first_mes ?? '')],
    ['mes_example', String(d.mes_example ?? '')],
    ['system_prompt', String(d.system_prompt ?? '')],
    ['post_history_instructions', String(d.post_history_instructions ?? '')],
  ];
  for (const [field, text] of fields) {
    if (!text) continue;
    const t = countTokens(text);
    const limit = field === 'description' ? th.descriptionTokens : field === 'first_mes' ? th.firstMesTokens : th.fieldTokens;
    if (limit && t.total > limit) {
      issues.push({
        field,
        severity: t.total > limit * 1.5 ? 'error' : 'warn',
        message: `${field} token 超限：${t.total} > ${limit}`,
        suggestion: '精简内容，或把设定移入世界书按需注入',
      });
    }
  }

  /* ---- 世界书 ---- */
  const book = d.character_book as { entries?: Array<Record<string, unknown>> } | undefined;
  if (book?.entries?.length) {
    // 键冲突：同 key 且 content 不同
    const keyMap = new Map<string, number[]>();
    book.entries.forEach((e, i) => {
      const keys = (e.keys as string[] | undefined) ?? [];
      const enabled = (e.enabled as boolean | undefined) ?? true;
      if (!enabled) return;
      if (!keys.length && !(e.constant as boolean | undefined)) {
        issues.push({ field: `character_book.entries[${i}]`, severity: 'warn', message: `条目 ${i}（${(e.comment as string) || '无备注'}）既无关键词也非常驻，永远不会注入` });
      }
      for (const k of keys) {
        const kk = k.trim().toLowerCase();
        if (!kk) continue;
        keyMap.set(kk, [...(keyMap.get(kk) ?? []), i]);
      }
    });
    for (const [k, idxs] of keyMap) {
      if (idxs.length > 1) {
        const contents = new Set(idxs.map((i) => String(book.entries![i]!.content ?? '')));
        if (contents.size > 1) {
          issues.push({
            field: 'character_book',
            severity: 'warn',
            message: `世界书键「${k}」命中 ${idxs.length} 个不同内容的条目（${idxs.join(', ')}），可能重复注入`,
            suggestion: '合并条目或区分关键词',
          });
        }
      }
    }
  }

  /* ---- 正则 ---- */
  const regexScripts = (d.extensions as { regex_scripts?: Array<Record<string, unknown>> } | undefined)?.regex_scripts ?? [];
  regexScripts.forEach((s, i) => {
    const find = String(s.findRegex ?? '');
    if (!find) {
      issues.push({ field: `regex_scripts[${i}]`, severity: 'warn', message: `正则 ${String(s.scriptName ?? i)} 缺少查找表达式` });
      return;
    }
    try {
      compileFindRegex(find);
    } catch (e) {
      issues.push({ field: `regex_scripts[${i}]`, severity: 'error', message: `正则「${String(s.scriptName ?? i)}」语法错误：${(e as Error).message}` });
    }
  });

  /* ---- 嵌图体积（外链/内嵌检查） ---- */
  const allText = fields.map(([, t]) => t).join('\n');
  const dataUrls = allText.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{1000,}/g) ?? [];
  if (dataUrls.length) {
    const totalKb = dataUrls.reduce((a, u) => a + Math.ceil((u.length * 3) / 4 / 1024), 0);
    if (totalKb > (th.embeddedImageKb ?? 2048)) {
      issues.push({
        field: 'embedded_images',
        severity: 'warn',
        message: `检测到 ${dataUrls.length} 处 base64 嵌图，共约 ${totalKb} KB，将显著膨胀卡体积与上下文`,
        suggestion: '改用外链图片（本地图目录或在线图床）',
      });
    } else {
      issues.push({ field: 'embedded_images', severity: 'info', message: `检测到 ${dataUrls.length} 处 base64 嵌图（约 ${totalKb} KB）` });
    }
  }

  /* ---- {{user}}/{{char}} 使用检查 ---- */
  const usesUser = allText.includes('{{user}}');
  if (!usesUser) {
    issues.push({ field: 'macros', severity: 'info', message: '文本中未使用 {{user}} 宏（开场白中建议使用以适配玩家名）' });
  }
  const badMacro = /\{\{(?!user|char|random:|setvar:|var::|getvar::|time|date|\})[^}]*\}\}/i.exec(allText);
  if (badMacro) {
    issues.push({ field: 'macros', severity: 'info', message: `疑似未识别的宏：${badMacro[0]}` });
  }

  const order = { error: 0, warn: 1, info: 2 } as const;
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
