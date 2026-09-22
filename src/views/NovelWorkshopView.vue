<script setup lang="ts">
/** 同人卡工坊：导入 txt/epub → 角色扫描 → 选定 → 上下文 → 抽卡 → 世界书 → 文风 → 开场白 → user 人设 → 导出 */
import { computed, onMounted, ref } from 'vue';
import {
  NSpace, NButton, NCard, NStep, NSteps, NTag, useMessage, NIcon, NEmpty, NModal, NInput, NCheckbox, NCheckboxGroup, NText, NTimeline, NTimelineItem, NSpin, NGrid, NGridItem, NCollapse, NCollapseItem,
} from 'naive-ui';
import { DocumentAttachOutline, PeopleOutline, SearchOutline, ColorWandOutline, BookOutline, DownloadOutline, TrashOutline } from '@vicons/ionicons5';
import * as projectService from '@/services/projectService';
import { listTemplates, findPrompt } from '@/services/promptLookup';
import type { NovelProjectRow } from '@/services/types';
import { PIPELINE_STAGE_LABELS } from '@/services/types';
import { blankCard } from '@/core/card';
import * as cardService from '@/services/cardService';
import { runFieldAi, runFieldAiJson } from '@/services/aiService';
import { useWorkspace } from '@/stores/workspace';

const message = useMessage();
const ws = useWorkspace();

const projects = ref<NovelProjectRow[]>([]);
const active = ref<NovelProjectRow | null>(null);
const busy = ref('');
const showImport = ref(false);
const importTitle = ref('');
const importText = ref('');
const templateOptions = ref<{ label: string; value: string }[]>([]);
const chosenTplId = ref<string | null>(null);

onMounted(async () => {
  projects.value = await projectService.listProjects();
  const tpls = await listTemplates('card');
  templateOptions.value = tpls.map((t) => ({ label: t.name, value: t.id }));
});

async function reload() {
  projects.value = await projectService.listProjects();
  const id = active.value?.id;
  active.value = id ? projects.value.find((p) => p.id === id) ?? null : null;
}

async function openProject(p: NovelProjectRow) {
  active.value = p;
}

async function removeProject(p: NovelProjectRow) {
  const { getStore } = await import('@/db');
  await (await getStore()).delete('novel_projects', p.id);
  if (active.value?.id === p.id) active.value = null;
  await reload();
}

/* 导入 txt：读取文件 */
async function pickNovel() {
  const files = await (await import('@/utils/file')).pickFiles('.txt,.text', false);
  if (!files.length) return;
  const f = files[0]!;
  importTitle.value = f.name.replace(/\.txt$/i, '');
  importText.value = await f.text();
}

async function pickEpub() {
  const files = await (await import('@/utils/file')).pickFiles('.epub', false);
  if (!files.length) return;
  try {
    const bytes = new Uint8Array(await files[0]!.arrayBuffer());
    const p = await projectService.createProjectFromEpub(bytes);
    await reload();
    active.value = p;
    showImport.value = false;
    message.success(`epub 解析成功：${p.chapters.length} 章`);
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function createFromText() {
  if (!importText.value.trim()) {
    message.error('没有文本');
    return;
  }
  const p = await projectService.createProjectFromText(importTitle.value || '未命名小说', `${importTitle.value}.txt`, importText.value);
  await reload();
  active.value = p;
  showImport.value = false;
  message.success(`切分出 ${p.chapters.length} 章`);
}

/* 流水线各步 */
const candidates = ref<{ name: string; count: number }[]>([]);
const selectedNames = ref<string[]>([]);

async function stageScan() {
  if (!active.value) return;
  busy.value = 'scan';
  try {
    candidates.value = projectService.scanCandidates(active.value);
    await projectService.updateProject(active.value.id, (p) => {
      p.pipelineState.candidates = candidates.value;
      p.pipelineState.stage = 'select';
      projectService.logStage(p, 'scan', `扫描出 ${candidates.value.length} 个候选名词`);
    });
    await reload();
    message.success(`扫描完成，勾选要入卡的角色/名词（含别名合并可在下一步处理）`);
  } finally {
    busy.value = '';
  }
}

async function stageSelect() {
  if (!active.value) return;
  await projectService.updateProject(active.value.id, (p) => {
    p.pipelineState.selected = selectedNames.value;
    p.pipelineState.stage = 'context';
    projectService.logStage(p, 'select', `选定 ${selectedNames.value.length} 个：${selectedNames.value.join('、')}`);
  });
  await reload();
}

async function stageContext() {
  if (!active.value) return;
  busy.value = 'context';
  try {
    const r = projectService.buildContext(active.value, selectedNames.value);
    await projectService.updateProject(active.value.id, (p) => {
      p.pipelineState.context = r.text;
      p.pipelineState.stage = 'extract';
      projectService.logStage(p, 'context', `命中 ${r.hits} 段，压缩至 ${r.text.length} 字`);
    });
    await reload();
    message.success(`上下文构建完成（${r.hits} 处命中）`);
  } finally {
    busy.value = '';
  }
}

/** 分块全书分析（每块调一次 LLM，增量拼进 analysis） */
async function stageAnalysis() {
  if (!active.value) return;
  const prompt = await findPrompt('novel:analysis');
  if (!prompt) return;
  busy.value = 'analysis';
  try {
    const chapters = active.value.chapters;
    const CHUNK_CHAPTERS = 10;
    let analysis = active.value.pipelineState.analysis;
    for (let i = 0; i < chapters.length; i += CHUNK_CHAPTERS) {
      const chunk = chapters.slice(i, i + CHUNK_CHAPTERS).map((c) => `【${c.title}】\n${c.content}`).join('\n\n');
      // eslint-disable-next-line no-await-in-loop
      const part = await runFieldAi({
        feature: '工坊:全书分析',
        systemPrompt: prompt.system,
        userPrompt: prompt.userTemplate
          .replaceAll('{TITLE}', active.value.title)
          .replaceAll('{PREV}', analysis ? analysis.slice(-4000) : '（无）')
          .replaceAll('{CHUNK}', chunk.slice(0, 60_000)),
      });
      analysis = `${analysis}\n\n${part}`.trim();
      // eslint-disable-next-line no-await-in-loop
      await projectService.updateProject(active.value!.id, (p) => {
        p.pipelineState.analysis = analysis;
      });
      await reload();
    }
    await projectService.updateProject(active.value.id, (p) => projectService.logStage(p, 'extract', `全书分析完成（${analysis.length} 字）`));
    await reload();
    message.success('全书分析完成');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

interface ExtractedBookEntry { comment: string; keys: string[]; content: string; constant?: boolean; insertion_order?: number }

async function stageExtract() {
  if (!active.value) return;
  const prompt = await findPrompt('novel:extract');
  const wbPrompt = await findPrompt('novel:worldbook');
  if (!prompt || !wbPrompt) return;
  busy.value = 'extract';
  try {
    const schema = `{"name":"角色名","description":"角色描述(markdown)","personality":"","scenario":"","first_mes":"","tags":[]}`;
    const cardJson = await runFieldAiJson<Record<string, unknown>>({
      feature: '工坊:抽卡',
      systemPrompt: prompt.system,
      userPrompt: prompt.userTemplate
        .replaceAll('{ANALYSIS}', active.value.pipelineState.analysis || '（无分析，直接依据原文）')
        .replaceAll('{CONTEXT}', active.value.pipelineState.context.slice(0, 40_000))
        .replaceAll('{SCHEMA}', schema),
    });
    const card = blankCard(String(cardJson.name ?? active.value.title));
    Object.assign(card.data as Record<string, unknown>, cardJson);
    (card.data as Record<string, unknown>).creator_notes = `由同人卡工坊从《${active.value.title}》生成`;

    const entries = await runFieldAiJson<ExtractedBookEntry[]>({
      feature: '工坊:世界书六类',
      systemPrompt: wbPrompt.system,
      userPrompt: wbPrompt.userTemplate
        .replaceAll('{ANALYSIS}', active.value.pipelineState.analysis.slice(0, 20_000))
        .replaceAll('{CONTEXT}', active.value.pipelineState.context.slice(0, 20_000))
        .replaceAll('{SELECTED}', selectedNames.value.join('、')),
    }).catch(() => [] as ExtractedBookEntry[]);

    (card.data as Record<string, unknown>).character_book = {
      name: active.value.title,
      entries: entries.map((e, i) => ({
        id: i, keys: e.keys ?? [], secondary_keys: [], comment: e.comment ?? '',
        content: e.content ?? '', constant: Boolean(e.constant), selective: false,
        insertion_order: e.insertion_order ?? 100, enabled: true, position: 'before_char', use_regex: false,
        extensions: {},
      })),
    };

    await projectService.updateProject(active.value.id, (p) => {
      p.pipelineState.extractedCard = card;
      p.pipelineState.stage = 'style';
      projectService.logStage(p, 'extract', `抽卡完成 + 世界书 ${entries.length} 条`);
    });
    await reload();
    message.success('成卡草稿已生成（含世界书）');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function stageGreeting() {
  if (!active.value?.pipelineState.extractedCard) return;
  const stylePrompt = await findPrompt('novel:style');
  const greetPrompt = await findPrompt('novel:greeting');
  if (!greetPrompt) return;
  busy.value = 'greeting';
  try {
    let style = '';
    if (stylePrompt) {
      style = await runFieldAi({
        feature: '工坊:文风蒸馏',
        systemPrompt: stylePrompt.system,
        userPrompt: stylePrompt.userTemplate.replaceAll('{CONTEXT}', active.value.pipelineState.context.slice(0, 30_000)),
      });
    }
    const r = await runFieldAiJson<{ greetings: string[] }>({
      feature: '工坊:开场白',
      systemPrompt: greetPrompt.system,
      userPrompt: greetPrompt.userTemplate
        .replaceAll('{ANALYSIS}', active.value.pipelineState.analysis.slice(0, 15_000))
        .replaceAll('{STYLE}', style || '（未蒸馏）')
        .replaceAll('{CONTEXT}', active.value.pipelineState.context.slice(0, 15_000)),
    });
    await projectService.updateProject(active.value.id, (p) => {
      if (p.pipelineState.extractedCard) {
        (p.pipelineState.extractedCard.data as Record<string, unknown>).first_mes = r.greetings?.[0] ?? '';
        (p.pipelineState.extractedCard.data as Record<string, unknown>).alternate_greetings = r.greetings?.slice(1) ?? [];
      }
      p.pipelineState.stage = 'persona';
      projectService.logStage(p, 'greeting', `生成 ${r.greetings?.length ?? 0} 个开场白`);
    });
    await reload();
    message.success('开场白完成');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function stagePersona() {
  if (!active.value) return;
  const p = await findPrompt('novel:persona');
  if (!p) return;
  busy.value = 'persona';
  try {
    const persona = await runFieldAi({
      feature: '工坊:user人设',
      systemPrompt: p.system,
      userPrompt: p.userTemplate.replaceAll('{ANALYSIS}', active.value.pipelineState.analysis.slice(0, 15_000)),
    });
    await projectService.updateProject(active.value.id, (pr) => {
      pr.pipelineState.userPersona = persona;
      pr.pipelineState.stage = 'done';
      projectService.logStage(pr, 'persona', 'user 人设完成');
    });
    await reload();
    message.success('流水线完成，可以导出成卡');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function exportCard() {
  if (!active.value?.pipelineState.extractedCard) return;
  const row = await cardService.importCardFromJson(JSON.parse(JSON.stringify(active.value.pipelineState.extractedCard)));
  await ws.refreshCards(true);
  message.success(`已入库卡库（${row.row.name}），可去编辑器继续打磨`);
}

const stageIndex = computed(() => {
  const order: NovelProjectRow['pipelineState']['stage'][] = ['scan', 'select', 'context', 'extract', 'worldbook', 'style', 'greeting', 'persona', 'done'];
  if (!active.value) return 1;
  return Math.max(1, order.indexOf(active.value.pipelineState.stage) + 1);
});
</script>

<template>
  <div style="max-width: 1000px">
    <NSpace :size="10" style="margin-bottom: 14px" align="center">
      <NButton size="small" type="primary" @click="showImport = true">
        <template #icon><NIcon><DocumentAttachOutline /></NIcon></template>导入小说（txt / epub）
      </NButton>
      <NText depth="3" style="font-size: 12px">项目化保存，断点续跑：每步结果落库，中断后从当前阶段继续</NText>
    </NSpace>

    <NSpace v-if="!active" vertical :size="10">
      <NEmpty v-if="!projects.length" description="还没有项目。导入一部小说开始同人卡制作" />
      <NCard v-for="p in projects" :key="p.id" size="small">
        <template #header>
          <NSpace :size="8" align="center">
            <b>{{ p.title }}</b>
            <NTag size="tiny" :bordered="false" type="info">{{ p.chapters.length }} 章</NTag>
            <NTag size="tiny" :bordered="false">{{ PIPELINE_STAGE_LABELS[p.pipelineState.stage] }}</NTag>
          </NSpace>
        </template>
        <template #header-extra>
          <NSpace :size="6">
            <NButton size="tiny" secondary @click="openProject(p)">打开</NButton>
            <NButton size="tiny" quaternary type="error" @click="removeProject(p)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
            </NButton>
          </NSpace>
        </template>
        <NText depth="3" style="font-size: 12px">来源：{{ p.sourceName }} · 更新于 {{ new Date(p.updatedAt).toLocaleString() }}</NText>
      </NCard>
    </NSpace>

    <div v-else>
      <NSpace :size="8" align="center" style="margin-bottom: 14px">
        <NButton size="tiny" quaternary @click="active = null">‹ 返回项目列表</NButton>
        <b style="font-size: 15px">{{ active.title }}</b>
        <NTag size="tiny" :bordered="false">{{ active.chapters.length }} 章</NTag>
      </NSpace>

      <NSteps :current="stageIndex" size="small" style="margin-bottom: 16px">
        <NStep title="扫描" />
        <NStep title="选定" />
        <NStep title="分析/上下文" />
        <NStep title="抽卡+世界书" />
        <NStep title="开场白" />
        <NStep title="人设/导出" />
      </NSteps>

      <NGrid :cols="3" :x-gap="14">
        <NGridItem :span="1">
          <NCard size="small" title="流程日志（断点续跑）">
            <NTimeline>
              <NTimelineItem v-for="(l, i) in active.pipelineState.logs" :key="i" :title="PIPELINE_STAGE_LABELS[l.stage]" :content="l.message" :time="new Date(l.at).toLocaleString()" line-type="dashed" />
            </NTimeline>
          </NCard>
          <NCard v-if="active.pipelineState.userPersona" size="small" title="user 人设（复制到酒馆 Persona）" style="margin-top: 12px">
            <NInput type="textarea" :value="active.pipelineState.userPersona" :rows="8" readonly />
          </NCard>
        </NGridItem>

        <NGridItem :span="2">
          <NSpace vertical :size="12">
            <!-- 扫描/选定 -->
            <NCard size="small" title="① 角色扫描与选定">
              <template #header-extra>
                <NButton size="tiny" :loading="busy === 'scan'" @click="stageScan">
                  <template #icon><NIcon><PeopleOutline /></NIcon></template>扫描
                </NButton>
              </template>
              <NEmpty v-if="!candidates.length && !active.pipelineState.candidates.length" size="small" description="先扫描" />
              <template v-else>
                <NCheckboxGroup v-model:value="selectedNames">
                  <NSpace :size="6" wrap>
                    <NCheckbox v-for="c in (candidates.length ? candidates : active.pipelineState.candidates)" :key="c.name" :value="c.name" :label="`${c.name}（${c.count}）`" />
                  </NSpace>
                </NCheckboxGroup>
                <NSpace style="margin-top: 10px">
                  <NButton size="tiny" type="primary" :disabled="!selectedNames.length" @click="stageSelect">确认选定（{{ selectedNames.length }}）</NButton>
                </NSpace>
              </template>
            </NCard>

            <!-- 上下文 + 分析 -->
            <NCard size="small" title="② 上下文检索与全书分析">
              <NSpace :size="8">
                <NButton size="tiny" secondary :loading="busy === 'context'" :disabled="!active.pipelineState.selected.length" @click="stageContext">
                  <template #icon><NIcon><SearchOutline /></NIcon></template>构建上下文
                </NButton>
                <NButton size="tiny" secondary :loading="busy === 'analysis'" @click="stageAnalysis">
                  <template #icon><NIcon><BookOutline /></NIcon></template>全书分析（分块 LLM）
                </NButton>
                <NTag v-if="active.pipelineState.context" size="tiny" :bordered="false" type="success">上下文 {{ active.pipelineState.context.length }} 字</NTag>
                <NTag v-if="active.pipelineState.analysis" size="tiny" :bordered="false" type="success">分析 {{ active.pipelineState.analysis.length }} 字</NTag>
              </NSpace>
              <NCollapse v-if="active.pipelineState.analysis" style="margin-top: 8px">
                <NCollapseItem title="查看分析" name="a">
                  <NInput type="textarea" :value="active.pipelineState.analysis" :rows="14" readonly />
                </NCollapseItem>
              </NCollapse>
            </NCard>

            <!-- 抽卡 -->
            <NCard size="small" title="③ 抽卡 + 世界书六类任务">
              <NSpace :size="8">
                <NButton size="tiny" type="primary" :loading="busy === 'extract'" :disabled="!active.pipelineState.selected.length" @click="stageExtract">
                  <template #icon><NIcon><ColorWandOutline /></NIcon></template>一键抽取成卡
                </NButton>
              </NSpace>
              <NText depth="3" style="font-size: 12px; display: block; margin-top: 6px">
                description → personality → first_mes → 世界书（世界观/蓝灯/配角/剧情分段/人物列表/大纲）按所选模板一次生成
              </NText>
              <NCollapse v-if="active.pipelineState.extractedCard" style="margin-top: 8px">
                <NCollapseItem title="查看成卡 JSON" name="c">
                  <NInput type="textarea" :value="JSON.stringify(active.pipelineState.extractedCard, null, 2)" :rows="14" readonly />
                </NCollapseItem>
              </NCollapse>
            </NCard>

            <!-- 开场白 + 人设 -->
            <NCard size="small" title="④ 文风开场白与 user 人设">
              <NSpace :size="8">
                <NButton size="tiny" secondary :loading="busy === 'greeting'" :disabled="!active.pipelineState.extractedCard" @click="stageGreeting">文风蒸馏 + 开场白</NButton>
                <NButton size="tiny" secondary :loading="busy === 'persona'" @click="stagePersona">生成 user 人设</NButton>
                <NButton size="tiny" type="primary" :disabled="!active.pipelineState.extractedCard" @click="exportCard">
                  <template #icon><NIcon><DownloadOutline /></NIcon></template>导出成卡入库
                </NButton>
              </NSpace>
            </NCard>
          </NSpace>
        </NGridItem>
      </NGrid>
    </div>

    <NModal v-model:show="showImport" preset="card" title="导入小说" style="width: 640px">
      <NSpace vertical :size="10">
        <NSpace :size="8">
          <NButton size="small" secondary @click="pickNovel">选择 txt</NButton>
          <NButton size="small" secondary @click="pickEpub">选择 epub</NButton>
        </NSpace>
        <NInput v-model:value="importTitle" placeholder="书名（txt 导入用）" />
        <NInput v-model:value="importText" type="textarea" :rows="10" placeholder="或直接粘贴文本（txt 模式）" />
        <NSpace justify="end">
          <NButton size="small" @click="showImport = false">取消</NButton>
          <NButton size="small" type="primary" :disabled="!importText.trim()" @click="createFromText">创建项目</NButton>
        </NSpace>
      </NSpace>
    </NModal>

    <NSpin :show="!!busy" style="position: fixed; right: 30px; bottom: 30px" />
  </div>
</template>

<style scoped>
</style>
