/**
 * 诊断服务：静态检查 + LLM 诊断 skill 执行 + 修复应用。
 */
import { runStaticChecks, DEFAULT_THRESHOLDS, type DiagIssue, type DiagThresholds } from '@/core/diag/staticChecks';
import type { AnyCard } from '@/core/card';
import { getStore } from '@/db';
import type { SkillRow } from './types';
import { runFieldAiJson } from './aiService';
import { extractJson } from '@/core/llm';
import { getActiveClient, logUsage } from './aiService';

export { DEFAULT_THRESHOLDS };
export type { DiagIssue, DiagThresholds };

export function staticDiagnose(card: AnyCard, thresholds?: DiagThresholds): DiagIssue[] {
  return runStaticChecks(card, thresholds);
}

export interface DoctorReport {
  overall: { score: number; summary: string };
  dimensions: { name: string; score: number; comment: string }[];
  issues: { severity: string; field: string; evidence: string; problem: string }[];
  prescriptions: { for: string; action: string; rewrite?: string }[];
}

/** 把卡片打包成诊断上下文（脱脂版：去掉超大 base64） */
export function cardToDiagContext(card: AnyCard): string {
  const slim = JSON.parse(JSON.stringify(card)) as AnyCard;
  const text = JSON.stringify(slim, null, 1);
  const trimmed = text.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{100,}/g, '[base64图片已省略]');
  return trimmed.length > 60_000 ? `${trimmed.slice(0, 60_000)}\n…[过长截断]` : trimmed;
}

export async function listSkills(): Promise<SkillRow[]> {
  return (await (await getStore()).list<SkillRow>('skills')).sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
}

export async function saveSkill(s: Omit<SkillRow, 'id'> & { id?: string }): Promise<SkillRow> {
  const store = await getStore();
  const id = s.id ?? `skill_${Date.now().toString(36)}`;
  const row: SkillRow = { ...s, id, builtin: false };
  await store.put('skills', id, row);
  return row;
}

export async function deleteSkill(id: string): Promise<void> {
  const store = await getStore();
  const prev = await store.get<SkillRow>('skills', id);
  if (prev?.builtin) throw new Error('内置 skill 不可删除');
  await store.delete('skills', id);
}

/** 执行 LLM 诊断 skill（当前为单轮结构化；skill.steps 作为执行说明注入） */
export async function runDoctorSkill(
  skill: SkillRow,
  card: AnyCard,
  opts: { onDelta?: (d: string, full: string) => void; signal?: AbortSignal } = {},
): Promise<DoctorReport> {
  const staticIssues = staticDiagnose(card);
  const staticSummary = staticIssues.length
    ? staticIssues.map((i) => `[${i.severity}] ${i.field}: ${i.message}`).join('\n')
    : '静态检查无问题';

  const { client, channel } = await getActiveClient('text');
  const result = await client.chat({
    messages: [
      {
        role: 'system',
        content: `${skill.systemPrompt}\n\n执行步骤：\n${skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n最终只输出 JSON，结构：${skill.outputSchema}`,
      },
      {
        role: 'user',
        content: `【本地静态检查结果（供参考，不要重复罗列）】\n${staticSummary}\n\n【角色卡全文】\n${cardToDiagContext(card)}`,
      },
    ],
    onDelta: opts.onDelta,
    signal: opts.signal,
    jsonMode: true,
    maxContinues: 3,
  });
  await logUsage(channel, `诊断:${skill.name}`, result);
  const report = extractJson<DoctorReport>(result.text);
  return report;
}

/* ---------------- 修复应用 ---------------- */

export type PatchOp =
  | { field: string; value: string }
  | { field: string; value: string[] };

/** 按处方路径应用修复（field 支持点路径如 first_mes / tags） */
export function applyPatch(card: AnyCard, ops: PatchOp[]): AnyCard {
  const next = JSON.parse(JSON.stringify(card)) as AnyCard;
  const data = next.data as Record<string, unknown>;
  for (const op of ops) {
    data[op.field] = op.value;
  }
  return next;
}
