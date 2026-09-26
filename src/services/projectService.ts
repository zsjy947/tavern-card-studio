/**
 * 同人卡项目：txt/epub 导入 → 章节切分 → 流水线状态持久化（断点续跑）。
 */
import { getStore, genId } from '@/db';
import { splitChapters, parseEpub, scanCharacterNames, collectContext, type Chapter } from '@/core/novel';
import type { NovelProjectRow, PipelineStage } from './types';

export async function createProjectFromText(title: string, sourceName: string, text: string): Promise<NovelProjectRow> {
  const chapters = splitChapters(text);
  return persistNew(title, sourceName, chapters);
}

export async function createProjectFromEpub(bytes: Uint8Array): Promise<NovelProjectRow> {
  const parsed = await parseEpub(bytes);
  return persistNew(parsed.title, `${parsed.title}.epub`, parsed.chapters);
}

async function persistNew(title: string, sourceName: string, chapters: Chapter[]): Promise<NovelProjectRow> {
  if (!chapters.length) throw new Error('没有解析出任何章节');
  const now = new Date().toISOString();
  const row: NovelProjectRow = {
    id: genId('novel'),
    title,
    sourceName,
    chapters: chapters.map((c) => ({ index: c.index, title: c.title, content: c.content, startLine: 0 })),
    pipelineState: {
      stage: 'scan',
      candidates: [],
      selected: [],
      aliases: {},
      analysis: '',
      context: '',
      templateId: null,
      cardTemplateFilled: null,
      extractedCard: null,
      worldbookEntries: null,
      worldbookMode: null,
      userPersona: '',
      greetings: [],
      logs: [{ at: now, stage: 'chapters', message: `切分出 ${chapters.length} 章` }],
    },
    createdAt: now,
    updatedAt: now,
  };
  await (await getStore()).put('novel_projects', row.id, row);
  return row;
}

export async function listProjects(): Promise<NovelProjectRow[]> {
  return (await (await getStore()).list<NovelProjectRow>('novel_projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<NovelProjectRow | undefined> {
  return (await getStore()).get<NovelProjectRow>('novel_projects', id);
}

export async function updateProject(id: string, mutate: (p: NovelProjectRow) => void): Promise<NovelProjectRow> {
  const store = await getStore();
  const prev = await store.get<NovelProjectRow>('novel_projects', id);
  if (!prev) throw new Error(`项目不存在：${id}`);
  const next: NovelProjectRow = JSON.parse(JSON.stringify(prev));
  mutate(next);
  next.updatedAt = new Date().toISOString();
  await store.put('novel_projects', id, next);
  return next;
}

export function logStage(p: NovelProjectRow, stage: PipelineStage, message: string): void {
  p.pipelineState.logs.push({ at: new Date().toISOString(), stage, message });
  p.pipelineState.stage = stage;
}

/** 角色扫描（本地词频，供选定） */
export function scanCandidates(p: NovelProjectRow, topN = 40): { name: string; count: number }[] {
  const text = p.chapters.map((c) => c.content).join('\n');
  return scanCharacterNames(text, topN);
}

/** 上下文检索（选定角色名 + 别名合并） */
export function buildContext(p: NovelProjectRow, names: string[], maxChars = 120_000): { text: string; hits: number } {
  const all: string[] = [];
  for (const n of names) {
    all.push(n, ...(p.pipelineState.aliases[n] ?? []));
  }
  return collectContext(p.chapters, all.filter(Boolean), { maxChars });
}
