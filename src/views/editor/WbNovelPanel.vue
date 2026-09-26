<script setup lang="ts">
/**
 * 世界书「小说提取」面板（迭代五 C3，编辑器轻量入口）：
 * 粘贴原文 → 主角模式/提取类型/切片参数 → 逐片×逐类提取（断点续跑）→ 逐类自检 → 评审 → 注入。
 * 与工坊 worldbook 阶段共用 core/novel/extract5 引擎与 novelExtractService 编排。
 */
import { computed, reactive, ref } from 'vue';
import {
  NAlert, NButton, NCheckbox, NCheckboxGroup, NIcon, NInput, NInputNumber, NRadioButton, NRadioGroup,
  NSpace, NTag, NText, NProgress, useMessage,
} from 'naive-ui';
import { PlayOutline, PauseOutline, StopOutline, TrashOutline } from '@vicons/ionicons5';
import type { AnyCard, BookEntry } from '@/core/card';
import {
  EXTRACT_TYPES,
  extractionToWorldEntries,
  type ExtractConfig,
  type ExtractType,
} from '@/core/novel/extract5';
import { initExtractState, extractOne, selfCheckType, type ExtractState } from '@/services/novelExtractService';
import * as aiService from '@/services/aiService';
import { pickFiles } from '@/utils/file';
import WbReviewTable, { type WbReviewRow } from './WbReviewTable.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ change: [] }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const book = computed(() => (data.value.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] });

const novelText = ref('');
const config = reactive<ExtractConfig>({
  novelName: '',
  chapterName: '',
  protagonistName: '',
  userMode: 'replace',
  chunkStrategy: 'auto',
  chaptersPerChunk: 5,
  wordsPerChunk: 10000,
  selectedTypes: ['character', 'eventline', 'timeline', 'setting', 'item_trajectory'],
});
const onlyFirstNChunks = ref(0); // 0 = 全部

async function importTxt() {
  const files = await pickFiles('text/plain,.txt,.epub', false);
  if (!files.length) return;
  novelText.value = (await files[0]!.text()).slice(0, 600_000);
  if (!config.novelName) config.novelName = files[0]!.name.replace(/\.(txt|epub)$/i, '');
  message.success(`已载入 ${novelText.value.length} 字`);
}

/* ---------------- 运行状态 ---------------- */

const running = ref(false);
const state = ref<ExtractState | null>(null);
const progressNote = ref('');
let abort: AbortController | null = null;

/** 分片签名：原文长度/切片参数变化即重新分片（断点续跑只在签名一致时保留进度） */
const chunkSig = computed(() =>
  JSON.stringify([novelText.value.length, config.chunkStrategy, config.chaptersPerChunk, config.wordsPerChunk]),
);

const chunkEstimate = computed(() => {
  if (!novelText.value.trim()) return null;
  const s = initExtractState({ ...config }, novelText.value);
  return { chunks: s.chunks.length, strategy: s.chunks[0]?.strategy ?? 'words', calls: s.chunks.length * config.selectedTypes.length };
});

const USER_MACRO = '{{user}}';
const protagonistHint = computed(() =>
  config.userMode === 'replace' ? `主角将由 ${USER_MACRO} 替代，不单独成条目` : '主角将作为 NPC 完整成条目',
);

/** 计划内分片数（「只跑前 N 片」），进度分母用它而非全量分片 */
const plannedChunks = computed(() => {
  if (!state.value) return 0;
  const total = state.value.chunks.length;
  return onlyFirstNChunks.value > 0 ? Math.min(onlyFirstNChunks.value, total) : total;
});

const progress = computed(() => {
  if (!state.value) return { done: 0, total: 0 };
  const types = state.value.config.selectedTypes;
  const done = state.value.doneKeys.filter((k) => Number(k.split(':')[0]) < plannedChunks.value).length;
  return { done, total: plannedChunks.value * types.length };
});

const typeStatus = computed(() => {
  if (!state.value) return [] as { key: ExtractType; label: string; done: boolean; checked: boolean }[];
  const active = state.value.config.selectedTypes;
  return active.map((t) => {
    const keys = state.value!.doneKeys.filter((k) => k.endsWith(`:${t}`));
    const pending = state.value!.chunks.length - keys.length;
    return { key: t, label: EXTRACT_TYPES.find((x) => x.key === t)!.label, done: pending === 0, checked: keys.length > 0 };
  });
});

async function run() {
  if (!novelText.value.trim()) {
    message.error('请先粘贴或导入小说原文');
    return;
  }
  running.value = true;
  abort = new AbortController();
  progressNote.value = '';
  try {
    const sig = chunkSig.value;
    // 断点续跑仅在原文与切片参数未变时保留进度；否则重新分片并清空已完成键
    if (!state.value || (state.value as ExtractState & { sig?: string }).sig !== sig) {
      state.value = initExtractState({ ...config }, novelText.value);
      (state.value as ExtractState & { sig?: string }).sig = sig;
    }
    const st = state.value;
    st.config = { ...config };
    const activeTypes = config.selectedTypes;
    const chunkCount = onlyFirstNChunks.value > 0 ? Math.min(onlyFirstNChunks.value, st.chunks.length) : st.chunks.length;

    for (let ci = 0; ci < chunkCount; ci++) {
      if (abort.signal.aborted) break;
      for (const type of activeTypes) {
        if (abort.signal.aborted) break;
        const key = `${ci}:${type}`;
        if (st.doneKeys.includes(key)) continue; // 断点续跑：跳过已完成
        progressNote.value = `第 ${ci + 1}/${chunkCount} 片 · ${EXTRACT_TYPES.find((x) => x.key === type)!.label}`;
        await extractOne(st, ci, type, { signal: abort.signal });
      }
    }
    if (abort.signal.aborted) message.warning('提取已暂停（进度已保留，可继续）');
    else {
      progressNote.value = '提取完成，逐类自检中…';
      for (const type of activeTypes) {
        await selfCheckType(st, type, { signal: abort.signal });
      }
      progressNote.value = '';
      message.success('提取完成（含自检），请评审后注入');
      buildReview();
    }
  } catch (e) {
    if (!abort.signal.aborted) message.error(`提取失败：${(e as Error).message}`);
  } finally {
    running.value = false;
    abort = null;
  }
}

function stop() {
  abort?.abort();
}

/* ---------------- 评审（转换后的世界书条目） ---------------- */

const reviewRows = ref<WbReviewRow[]>([]);
const checkedKeys = ref<string[]>([]);
const injected = ref(false);

function buildReview() {
  if (!state.value) return;
  const entries = extractionToWorldEntries(state.value.extraction, state.value.config);
  reviewRows.value = entries.map((e, i) => ({
    key: `e${i}`,
    comment: e.comment,
    keys: e.keys,
    content: e.content,
    constant: e.constant,
    tag: e.comment.split('·')[0]?.replace(/^\[[^\]]*\]\s*/, ''),
  }));
  checkedKeys.value = reviewRows.value.map((r) => r.key);
  injected.value = false;
}

/** 重新提取某类（先清除该类已有结果再跑全部分片） */
async function regenType(type: ExtractType) {
  if (!state.value || running.value) return;
  const st = state.value;
  st.doneKeys = st.doneKeys.filter((k) => !k.endsWith(`:${type}`));
  (st.extraction as unknown as Record<string, unknown>)[type] = [];
  running.value = true;
  abort = new AbortController();
  try {
    for (let ci = 0; ci < st.chunks.length; ci++) {
      progressNote.value = `重提取 ${EXTRACT_TYPES.find((x) => x.key === type)!.label} · 第 ${ci + 1}/${st.chunks.length} 片`;
      await extractOne(st, ci, type, { signal: abort.signal });
    }
    await selfCheckType(st, type);
    buildReview();
    message.success('该类已重新提取');
  } catch (e) {
    if (!abort.signal.aborted) message.error(`重提取失败：${(e as Error).message}`);
  } finally {
    running.value = false;
    progressNote.value = '';
    abort = null;
  }
}

function inject() {
  if (!state.value || !checkedKeys.value.length) return;
  const entries = extractionToWorldEntries(state.value.extraction, state.value.config);
  const chosen = entries.filter((_, i) => checkedKeys.value.includes(`e${i}`));
  if (!chosen.length) return;
  // 转成 BookEntry（补 id / secondary_keys）
  const baseId = book.value.entries.reduce((mx, e) => Math.max(mx, Number(e.id ?? -1)), -1) + 1;
  const toAdd: BookEntry[] = chosen.map((e, i) => ({
    ...e,
    id: baseId + i,
    secondary_keys: [],
    use_regex: false,
  }));
  const next = JSON.parse(JSON.stringify(book.value.entries)) as BookEntry[];
  next.push(...toAdd);
  data.value.character_book = { ...book.value, entries: next };
  emit('change');
  injected.value = true;
  message.success(`已注入 ${toAdd.length} 条（蓝绿灯自动分配 + 朔递归规则）`);
}
</script>

<template>
  <div class="wb-novel">
    <NAlert type="info" :bordered="false" style="margin-bottom: 10px; font-size: 12px">
      5 类轨迹分步提取：角色（5 轨迹）/ 事件线（主线·支线·暗线·伏笔）/ 时间线 / 设定 / 物品轨迹（只存获得与消耗，不存持有快照）。
      逐片×逐类调用，断点续跑；完成后逐类 AI 自检修正。
    </NAlert>

    <NSpace vertical :size="8">
      <NSpace :size="8" align="center">
        <NButton size="small" secondary @click="importTxt">导入 txt</NButton>
        <NInput v-model:value="config.novelName" size="small" placeholder="书名（可选）" style="width: 160px" />
        <NInput v-model:value="config.chapterName" size="small" placeholder="篇章名（条目前缀，可选）" style="width: 180px" />
        <NInput v-model:value="config.protagonistName" size="small" placeholder="主角名" style="width: 120px" />
        <NRadioGroup v-model:value="config.userMode" size="small">
          <NRadioButton value="replace">{{ USER_MACRO }} 替代主角</NRadioButton>
          <NRadioButton value="npc">主角作为 NPC</NRadioButton>
        </NRadioGroup>
      </NSpace>
      <NInput v-model:value="novelText" type="textarea" :rows="5" placeholder="粘贴小说原文（或点「导入 txt」）；超过 30 万字建议分篇章处理" />
      <NSpace align="center" :size="10" :wrap="false">
        <NCheckboxGroup v-model:value="config.selectedTypes">
          <NCheckbox v-for="t in EXTRACT_TYPES" :key="t.key" :value="t.key" style="margin-right: 10px" :title="t.desc">
            {{ t.label }}
          </NCheckbox>
        </NCheckboxGroup>
      </NSpace>
      <NSpace align="center" :size="10">
        <span class="wb-novel-label">每片章节数</span>
        <NInputNumber v-model:value="config.chaptersPerChunk" size="small" :min="1" :max="20" style="width: 80px" />
        <span class="wb-novel-label">字数回退片长</span>
        <NInputNumber v-model:value="config.wordsPerChunk" size="small" :min="2000" :max="50000" :step="1000" style="width: 110px" />
        <span class="wb-novel-label">只跑前</span>
        <NInputNumber v-model:value="onlyFirstNChunks" size="small" :min="0" placeholder="0" style="width: 90px" />
        <span class="wb-novel-label">片（0=全部）</span>
      </NSpace>
      <NText depth="3" style="font-size: 12px">
        预估：{{ chunkEstimate ? `切 ${chunkEstimate.chunks} 片（${chunkEstimate.strategy === 'chapter' ? '章节分组' : '字数回退'}）· 约 ${chunkEstimate.calls} 次 AI 调用` : '粘贴原文后显示预估' }}
        ；{{ protagonistHint }}
      </NText>
      <NSpace align="center" :size="8">
        <NButton size="small" type="primary" :disabled="!novelText.trim()" :loading="running" @click="run">
          <template #icon><NIcon><PlayOutline /></NIcon></template>{{ state ? '继续提取' : '开始提取' }}
        </NButton>
        <NButton v-if="running" size="small" type="error" secondary @click="stop">
          <template #icon><NIcon><StopOutline /></NIcon></template>暂停
        </NButton>
        <NButton v-if="state" size="tiny" quaternary type="error" @click="state = null">清空进度</NButton>
        <NProgress v-if="progress.total" type="line" :percentage="Math.round((progress.done / progress.total) * 100)" style="max-width: 260px" :show-indicator="false" />
        <NTag v-if="progress.total" size="small" :bordered="false">{{ progress.done }}/{{ progress.total }}</NTag>
        <NText v-if="progressNote" depth="3" style="font-size: 12px">{{ progressNote }}</NText>
      </NSpace>
      <NSpace v-if="typeStatus.length" :size="6">
        <NTag v-for="t in typeStatus" :key="t.key" size="small" :type="t.done ? 'success' : t.checked ? 'info' : 'default'" :bordered="false">
          {{ t.label }} {{ t.done ? '✓' : t.checked ? '…' : '' }}
        </NTag>
      </NSpace>
    </NSpace>

    <template v-if="reviewRows.length && !injected">
      <div class="wb-novel-divider">评审（{{ checkedKeys.length }}/{{ reviewRows.length }} 条已选；蓝绿灯已自动分配）</div>
      <WbReviewTable v-model:checked="checkedKeys" :rows="reviewRows" @regen="() => undefined" />
      <NSpace :size="8" style="margin-top: 10px">
        <NButton size="small" type="primary" :disabled="!checkedKeys.length" @click="inject">注入所选条目</NButton>
        <NButton v-for="t in EXTRACT_TYPES" :key="t.key" size="tiny" secondary :disabled="running" @click="regenType(t.key)">重提取{{ t.label }}</NButton>
      </NSpace>
    </template>
    <NAlert v-if="injected" type="success" :show-icon="false" style="margin-top: 10px">已注入；再次提取前建议先「清空进度」</NAlert>
  </div>
</template>

<style scoped>
.wb-novel-label { font-size: 12px; opacity: .75; white-space: nowrap; }
.wb-novel-divider {
  font-size: 12px; font-weight: 700; opacity: .75; margin: 12px 0 6px;
  border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.12)); padding-top: 10px;
}
</style>
