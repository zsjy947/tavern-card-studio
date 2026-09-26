<script setup lang="ts">
/**
 * 世界书「AI 批量生成」面板（迭代五 B）：
 * 五要素表单（世界观/类型多选/数量六级/风格/额外要求）→ 分批循环（每批 30，防重名，暂停/继续）
 * → 评审表（勾选/单条重生成/继续补充）→ 朔规则注入。
 * 参考小说素材存 extensions.tcsReferenceNovel，批量/重生成/补充三类 prompt 共用。
 */
import { computed, reactive, ref } from 'vue';
import {
  NAlert, NButton, NCheckbox, NCheckboxGroup, NIcon, NInput, NSelect, NSpace, NTag, NText, useMessage,
} from 'naive-ui';
import { PlayOutline, PauseOutline, StopOutline, TrashOutline } from '@vicons/ionicons5';
import type { AnyCard, BookEntry } from '@/core/card';
import {
  WB_ENTRY_TYPES,
  WB_QUANTITY_TIERS,
  WB_STYLES,
  shuoApplyEntry,
  totalBatches,
  type RawWbEntry,
  type WorldbookGenParams,
} from '@/core/lorebook/generate';
import * as lorebookAi from '@/services/lorebookAiService';
import * as aiService from '@/services/aiService';
import WbReviewTable, { type WbReviewRow } from './WbReviewTable.vue';
import { pickFiles } from '@/utils/file';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ change: [] }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const book = computed(() => (data.value.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] });

/* ---------------- 表单 ---------------- */

const form = reactive<WorldbookGenParams>({
  worldview: '',
  entryTypes: ['system', 'setting', 'npc', 'location', 'event'],
  tierIndex: 1,
  style: 'auto',
  extraRequirement: '',
});
const typeOptions = WB_ENTRY_TYPES.map((t) => ({ label: t.label, value: t.key }));
const tierOptions = WB_QUANTITY_TIERS.map((t, i) => ({ label: t.label, value: i }));
const styleOptions = WB_STYLES.map((s) => ({ label: s.label, value: s.key }));

/* ---------------- 参考小说 ---------------- */

const refNovel = computed({
  get: () => ((data.value.extensions ?? {}) as Record<string, unknown>).tcsReferenceNovel as string | undefined ?? '',
  set: (v: string) => {
    const ext = (data.value.extensions ?? {}) as Record<string, unknown>;
    ext.tcsReferenceNovel = v || undefined;
    data.value.extensions = ext;
    emit('change');
  },
});

async function importNovel() {
  const files = await pickFiles('text/plain,.txt', false);
  if (!files.length) return;
  refNovel.value = (await files[0]!.text()).slice(0, 200_000);
  message.success('参考小说已导入（存 extensions.tcsReferenceNovel）');
}

/* ---------------- 批量运行 ---------------- */

const running = ref(false);
const paused = ref(false);
const progress = reactive<{ batch: number; total: number; entries: number; note: string }>({
  batch: 0, total: 35, entries: 0, note: '',
});

let abort: AbortController | null = null;
const gate: lorebookAi.BatchGate = {
  isPaused: () => paused.value,
  wait: () => new Promise<void>((resolve) => { resumeResolve = resolve; }),
};
let resumeResolve: (() => void) | null = null;

const reviewRows = ref<WbReviewRow[]>([]);
const rawEntries = ref<RawWbEntry[]>([]);
const checkedKeys = ref<string[]>([]);

function toReviewRows(entries: RawWbEntry[]): WbReviewRow[] {
  return entries.map((e, i) => ({
    key: `${e.comment}#${i}`,
    comment: e.comment,
    keys: e.keys,
    content: e.content,
    constant: e.constant,
  }));
}

async function run(append: boolean) {
  if (!form.worldview.trim()) {
    message.error('请先填写世界观描述');
    return;
  }
  if (!append) {
    reviewRows.value = [];
    rawEntries.value = [];
    checkedKeys.value = [];
  }
  running.value = true;
  paused.value = false;
  abort = new AbortController();
  progress.total = totalBatches(WB_QUANTITY_TIERS[form.tierIndex]!.max);
  try {
    const result = await lorebookAi.runWorldbookBatchGeneration({
      params: { ...form },
      referenceNovel: refNovel.value || undefined,
      signal: abort.signal,
      gate,
      onBatch: (info) => {
        progress.batch = info.batchIndex;
        progress.entries = info.totalEntries;
        progress.note = info.note ?? '';
        if (info.batchEntries.length) {
          rawEntries.value.push(...info.batchEntries);
          reviewRows.value = toReviewRows(rawEntries.value);
        }
      },
    });
    if (result.cancelled) message.warning('批量生成已终止');
    else if (result.earlyComplete) message.success(`提前完成：已生成 ${result.entries.length} 条，进入评审`);
    else message.success(`全部批次完成：共 ${result.entries.length} 条`);
  } catch (e) {
    message.error(`批量生成失败：${(e as Error).message}`);
  } finally {
    running.value = false;
    paused.value = false;
    abort = null;
  }
}

function togglePause() {
  if (!running.value) return;
  paused.value = !paused.value;
  if (!paused.value && resumeResolve) {
    const r = resumeResolve;
    resumeResolve = null;
    r();
  }
}

function stop() {
  abort?.abort();
}

/* ---------------- 单条重生成 / 继续补充 ---------------- */

const regenKey = ref('');

async function regenOne(key: string) {
  const idx = rawEntries.value.findIndex((e, i) => `${e.comment}#${i}` === key);
  if (idx < 0) return;
  const entry = rawEntries.value[idx]!;
  regenKey.value = key;
  try {
    const typeName = WB_ENTRY_TYPES.filter((t) => form.entryTypes.includes(t.key)).map((t) => t.label).join('/');
    const raw = await aiService.runFieldAiJson<unknown>({
      feature: 'worldbook:regen',
      systemPrompt: '你是世界书条目作家。重写给定的世界书条目：保持条目的类型定位与触发关键词不变，只重写内容；具体自洽、拒绝空泛；全中文；引用一律用中文引号「」『』《》。输出 JSON 对象：{"comment":"条目名","keys":["关键词"],"content":"内容","constant":布尔}',
      userPrompt: `【原条目】\n${JSON.stringify({ comment: entry.comment, keys: entry.keys, content: entry.content }, null, 2)}\n\n【世界观】\n${form.worldview}\n\n【类型范围】${typeName || '不限'}\n${refNovel.value ? `\n## 参考小说素材\n${refNovel.value.slice(0, 6000)}` : ''}`,
      jsonSchemaHint: '{"comment":"","keys":[],"content":"","constant":false}',
    });
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      entry.comment = typeof o.comment === 'string' && o.comment ? o.comment : entry.comment;
      entry.content = typeof o.content === 'string' && o.content ? o.content : entry.content;
      if (Array.isArray(o.keys)) entry.keys = o.keys.filter((k): k is string => typeof k === 'string');
      if (typeof o.constant === 'boolean') entry.constant = o.constant;
      reviewRows.value = toReviewRows(rawEntries.value);
      message.success('已重生成');
    }
  } catch (e) {
    message.error(`重生成失败：${(e as Error).message}`);
  } finally {
    regenKey.value = '';
  }
}

async function continueMore() {
  // 继续补充：以当前已评审条目为「已生成名单」再跑一批
  const tier = WB_QUANTITY_TIERS[form.tierIndex]!;
  if (rawEntries.value.length >= tier.max) {
    message.info(`已达目标上限 ${tier.max} 条`);
    return;
  }
  await run(true);
}

/* ---------------- 注入（朔规则） ---------------- */

function inject() {
  if (!checkedKeys.value.length) {
    message.error('请先勾选要注入的条目');
    return;
  }
  const chosen = rawEntries.value.filter((e, i) => checkedKeys.value.includes(`${e.comment}#${i}`));
  const baseId = book.value.entries.reduce((mx, e) => Math.max(mx, Number(e.id ?? -1)), -1) + 1;
  const entries = chosen.map((e, i) => shuoApplyEntry(e, baseId + i, refNovel.value || undefined));
  const next = JSON.parse(JSON.stringify(book.value.entries)) as BookEntry[];
  next.push(...entries);
  data.value.character_book = { ...book.value, entries: next };
  emit('change');
  message.success(`已按朔规则注入 ${entries.length} 条（order=100；蓝灯 exclude_recursion；绿灯双禁递归）`);
  // 注入后从评审表移除
  rawEntries.value = rawEntries.value.filter((e, i) => !checkedKeys.value.includes(`${e.comment}#${i}`));
  reviewRows.value = toReviewRows(rawEntries.value);
  checkedKeys.value = [];
}

function clearReview() {
  rawEntries.value = [];
  reviewRows.value = [];
  checkedKeys.value = [];
}
</script>

<template>
  <div class="wb-batch">
    <NAlert type="info" :bordered="false" style="margin-bottom: 10px; font-size: 12px">
      分批生成：每批 30 条防 JSON 截断，批间回传已生成名单防重复；达到「下限且 ≥80% 上限」提前完成。
      注入按朔规则统一 order=100。
    </NAlert>

    <NSpace vertical :size="8">
      <NInput v-model:value="form.worldview" type="textarea" :rows="3" placeholder="世界观描述（必填）：世界类型、力量体系、主要势力、时代背景…" />
      <NSpace align="center" :size="10" :wrap="false">
        <NCheckboxGroup v-model:value="form.entryTypes">
          <NCheckbox v-for="t in typeOptions" :key="t.value" :value="t.value" :label="t.label" style="margin-right: 8px" />
        </NCheckboxGroup>
      </NSpace>
      <NSpace align="center" :size="10">
        <NSelect v-model:value="form.tierIndex" :options="tierOptions" size="small" style="width: 170px" />
        <NSelect v-model:value="form.style" :options="styleOptions" size="small" style="width: 190px" />
        <NInput v-model:value="form.extraRequirement" size="small" placeholder="额外要求（可选）" style="flex: 1" />
      </NSpace>
      <NSpace align="center" :size="8">
        <NButton size="small" secondary @click="importNovel">导入参考小说（txt）</NButton>
        <NButton v-if="refNovel" size="tiny" quaternary type="error" @click="refNovel = ''">
          <template #icon><NIcon><TrashOutline /></NIcon></template>清除素材（{{ refNovel.length }} 字）
        </NButton>
      </NSpace>
      <NInput v-if="refNovel" v-model:value="refNovel" type="textarea" :rows="2" placeholder="参考小说素材原文（按它的世界观、人物风格、笔法来生成）" />

      <NSpace align="center" :size="8">
        <NButton v-if="!running" size="small" type="primary" :disabled="!form.worldview.trim()" @click="run(reviewRows.length > 0)">
          <template #icon><NIcon><PlayOutline /></NIcon></template>
          {{ reviewRows.length ? '继续补充一批' : '开始批量生成' }}
        </NButton>
        <NButton v-else size="small" :type="paused ? 'primary' : 'warning'" @click="togglePause">
          <template #icon><NIcon><PauseOutline /></NIcon></template>{{ paused ? '继续' : '暂停' }}
        </NButton>
        <NButton v-if="running" size="small" type="error" secondary @click="stop">
          <template #icon><NIcon><StopOutline /></NIcon></template>终止
        </NButton>
        <NTag v-if="running || progress.batch" size="small" :bordered="false">
          第 {{ progress.batch }}/{{ progress.total }} 批 · 已 {{ progress.entries }} 条
        </NTag>
        <NText v-if="progress.note" depth="3" style="font-size: 12px">{{ progress.note }}</NText>
      </NSpace>
    </NSpace>

    <template v-if="reviewRows.length">
      <div class="wb-batch-divider">评审（勾选后注入；{{ checkedKeys.length }} 条已选）</div>
      <WbReviewTable v-model:checked="checkedKeys" :rows="reviewRows" @regen="regenOne" />
      <NSpace :size="8" style="margin-top: 10px">
        <NButton size="small" type="primary" :disabled="!checkedKeys.length" @click="inject">注入所选（朔规则）</NButton>
        <NButton size="small" @click="clearReview">清空评审</NButton>
      </NSpace>
    </template>
  </div>
</template>

<style scoped>
.wb-batch-divider {
  font-size: 12px; font-weight: 700; opacity: .75; margin: 12px 0 6px;
  border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.12)); padding-top: 10px;
}
</style>
