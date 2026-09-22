/** 提示词模板查找便捷入口 */
import { listTemplates } from './templateService';
import type { TemplateRow, TemplateKind } from './types';
import type { PromptPayload } from '@/builtins/promptTemplates';

export { listTemplates };

/** 按 target（如 field:description.optimize / novel:analysis）查提示词 */
export async function findPrompt(target: string): Promise<PromptPayload | null> {
  const rows = await listTemplates('prompt');
  const row = rows.find((r) => (r.payload as PromptPayload).target === target);
  return row ? (row.payload as PromptPayload) : null;
}

/** 某类模板的选项（下拉用） */
export async function templateOptions(kind: TemplateKind): Promise<{ label: string; value: string }[]> {
  const rows = await listTemplates(kind);
  return rows.map((r: TemplateRow) => ({ label: r.name, value: r.id }));
}
