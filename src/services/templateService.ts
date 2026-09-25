/**
 * 模板服务：内置模板首启播种 + CRUD + 导入导出。
 * 模板四类：card（整卡结构）/ statusbar（美化三件套）/ regex / prompt（提示词库）。
 */
import { getStore, genId } from '@/db';
import type { TemplateRow, TemplateKind } from './types';
import { BUILTIN_TEMPLATES } from '@/builtins';

const SEED_FLAG = 'templates_seeded_v1';

async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await getStore()).get<{ id: string; value: T }>('settings', key)?.then((r) => r?.value);
}

/** 进程内已播种标记：避免每次 listTemplates 都做缺漏检查 */
let seededInMemory = false;

/**
 * 内置模板播种（按 id 增量）：只补缺失的内置模板，不覆盖已有行。
 * 旧版的一次性种子标记会让后续版本新增的内置提示词/模板无法进入老库，
 * 这里改为每个进程首个模板操作时做一次缺漏补种。
 */
export async function ensureSeeded(): Promise<void> {
  if (seededInMemory) return;
  const store = await getStore();
  const existing = new Set((await store.list<TemplateRow>('templates')).map((t) => t.id));
  const missing = BUILTIN_TEMPLATES.filter((t) => !existing.has(t.id));
  const now = new Date().toISOString();
  for (const t of missing) {
    await store.put('templates', t.id, { ...t, builtin: true, createdAt: now, updatedAt: now } satisfies TemplateRow);
  }
  if (!(await getSetting<boolean>(SEED_FLAG))) {
    await store.put('settings', SEED_FLAG, { id: SEED_FLAG, value: true });
  }
  seededInMemory = true;
}

export async function listTemplates(kind?: TemplateKind): Promise<TemplateRow[]> {
  await ensureSeeded();
  const all = await (await getStore()).list<TemplateRow>('templates');
  return all
    .filter((t) => !kind || t.kind === kind)
    .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.createdAt.localeCompare(b.createdAt));
}

export async function getTemplate(id: string): Promise<TemplateRow | undefined> {
  await ensureSeeded();
  return (await getStore()).get<TemplateRow>('templates', id);
}

export async function saveTemplate(t: Omit<TemplateRow, 'builtin' | 'id' | 'createdAt' | 'updatedAt'> & { id?: string; builtin?: boolean }): Promise<TemplateRow> {
  const store = await getStore();
  const now = new Date().toISOString();
  const row: TemplateRow = {
    ...t,
    id: t.id ?? genId('tpl'),
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await store.put('templates', row.id, row);
  return row;
}

export async function updateTemplate(id: string, patch: Partial<TemplateRow>): Promise<void> {
  const store = await getStore();
  const prev = await store.get<TemplateRow>('templates', id);
  if (!prev) throw new Error(`模板不存在：${id}`);
  await store.put('templates', id, { ...prev, ...patch, updatedAt: new Date().toISOString() });
}

export async function deleteTemplate(id: string): Promise<void> {
  const store = await getStore();
  const prev = await store.get<TemplateRow>('templates', id);
  if (prev?.builtin) throw new Error('内置模板不可删除，可复制后修改');
  await store.delete('templates', id);
}

/** 复制模板（内置 → 用户可编辑副本） */
export async function cloneTemplate(id: string, newName?: string): Promise<TemplateRow> {
  const prev = await getTemplate(id);
  if (!prev) throw new Error(`模板不存在：${id}`);
  return saveTemplate({ ...prev, name: newName ?? `${prev.name}（副本）` } as Parameters<typeof saveTemplate>[0]);
}

export function exportTemplate(row: TemplateRow): string {
  return JSON.stringify({ tavernCardStudioTemplate: 1, kind: row.kind, name: row.name, description: row.description, payload: row.payload }, null, 2);
}

export async function importTemplate(text: string): Promise<TemplateRow> {
  const obj = JSON.parse(text) as { kind?: TemplateKind; name?: string; description?: string; payload?: unknown };
  if (!obj.kind || !obj.name || obj.payload === undefined) throw new Error('不是有效的模板文件（缺少 kind/name/payload）');
  return saveTemplate({ kind: obj.kind, name: obj.name, description: obj.description, payload: obj.payload });
}
