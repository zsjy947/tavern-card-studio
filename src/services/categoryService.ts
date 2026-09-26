/**
 * 卡片分类目录（优化文档 P0-1）：
 * categories 表接入 + 卡片归类/移出 + 删除分类回落未分类。
 */
import { getStore, genId } from '@/db';
import type { CardRow, CategoryRow } from './types';
import { updateCardPatch } from './cardService';

export async function listCategories(): Promise<CategoryRow[]> {
  return (await (await getStore()).list<CategoryRow>('categories')).sort((a, b) => a.sort - b.sort);
}

export async function createCategory(name: string): Promise<CategoryRow> {
  const existing = await listCategories();
  if (existing.some((c) => c.name === name)) throw new Error(`分类「${name}」已存在`);
  const row: CategoryRow = { id: genId('cat'), name, sort: existing.length };
  await (await getStore()).put('categories', row.id, row);
  return row;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const store = await getStore();
  const prev = await store.get<CategoryRow>('categories', id);
  if (!prev) throw new Error('分类不存在');
  await store.put('categories', id, { ...prev, name });
}

/** 删除分类：其中卡片回落「未分类」，不删卡 */
export async function deleteCategory(id: string): Promise<{ movedCards: number }> {
  const store = await getStore();
  const prev = await store.get<CategoryRow>('categories', id);
  if (!prev) throw new Error('分类不存在');
  const cards = await store.list<CardRow>('cards');
  let moved = 0;
  for (const c of cards) {
    if (c.categoryId === id) {
      await store.put('cards', c.id, { ...c, categoryId: null, updatedAt: new Date().toISOString() });
      moved++;
    }
  }
  await store.delete('categories', id);
  return { movedCards: moved };
}

export async function assignCategory(cardId: string, categoryId: string | null): Promise<void> {
  await updateCardPatch(cardId, { categoryId });
}

export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const store = await getStore();
  for (let i = 0; i < orderedIds.length; i++) {
    const prev = await store.get<CategoryRow>('categories', orderedIds[i]!);
    if (prev) await store.put('categories', prev.id, { ...prev, sort: i });
  }
}
