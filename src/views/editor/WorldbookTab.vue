<script setup lang="ts">
/** 世界书 Tab：条目表格 + 编辑器 + 与 ST 全局世界书互导 */
import { computed, ref } from 'vue';
import {
  NSpace, NButton, NDataTable, NTag, NDrawer, NDrawerContent, NForm, NFormItem, NInput,
  NDynamicTags, NSwitch, NInputNumber, NSelect, useMessage, NIcon, NPopconfirm, NTooltip, NText, NCollapse, NCollapseItem,
} from 'naive-ui';
import { AddOutline, TrashOutline, DownloadOutline, CloudUploadOutline, CopyOutline, SparklesOutline, BookOutline } from '@vicons/ionicons5';
import type { AnyCard, BookEntry } from '@/core/card';
import {
  characterBookToWorldInfo, worldInfoToCharacterBook, newWorldInfoEntry, wiEntryToEmbedded,
  type WorldInfoEntry,
} from '@/core/lorebook';
import TokenBadge from '@/components/TokenBadge.vue';
import FieldAiButton from '@/components/FieldAiButton.vue';
import { downloadText } from '@/services/backupService';
import { pickJsonFiles } from '@/utils/file';
import { h } from 'vue';
import WbBatchPanel from './WbBatchPanel.vue';
import WbNovelPanel from './WbNovelPanel.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const book = computed(() => (data.value.character_book ?? { name: '', entries: [] }) as { name?: string; entries: BookEntry[] });

function mutate(fn: (entries: BookEntry[]) => void) {
  const next = JSON.parse(JSON.stringify(book.value.entries)) as BookEntry[];
  fn(next);
  data.value.character_book = { ...book.value, entries: next };
  emit('change');
}

const editing = ref<number | null>(null);
const drawerOpen = ref(false);

function openEntry(i: number) {
  editing.value = i;
  drawerOpen.value = true;
}

function addEntry() {
  const e: BookEntry = {
    id: Math.max(-1, ...book.value.entries.map((x) => x.id)) + 1,
    keys: [], secondary_keys: [], comment: '新条目', content: '',
    constant: false, selective: false, insertion_order: 100, enabled: true,
    position: 'before_char', use_regex: false,
    extensions: { position: 0, display_index: book.value.entries.length, probability: 100, useProbability: true, depth: 4, selectiveLogic: 0 },
  };
  mutate((arr) => arr.push(e));
  openEntry(book.value.entries.length - 1);
}

function removeEntry(i: number) {
  mutate((arr) => arr.splice(i, 1));
}

const POSITION_OPTIONS = [
  { label: '角色定义之前（before_char）', value: 'before_char' },
  { label: '角色定义之后（after_char）', value: 'after_char' },
];

const rows = computed(() =>
  book.value.entries.map((e, i) => ({
    i,
    comment: e.comment || '（无备注）',
    keys: e.keys,
    constant: e.constant,
    enabled: e.enabled,
    order: e.insertion_order,
    position: e.position,
    tokens: e.content.length,
  })),
);

const columns = [
  {
    title: '备注',
    key: 'comment',
    ellipsis: { tooltip: true },
    render: (row: { i: number; comment: string }) =>
      h('a', { style: 'cursor:pointer;font-weight:600', onClick: () => openEntry(row.i) }, row.comment),
  },
  { title: '关键词', key: 'keys', render: (row: { keys: string[] }) => h('span', { style: 'font-size:12px' }, row.keys.join('、') || '—') },
  {
    title: '类型',
    key: 'constant',
    width: 90,
    render: (row: { constant: boolean }) =>
      h(NTag, { size: 'tiny', type: row.constant ? 'success' : 'info', bordered: false }, { default: () => (row.constant ? '蓝灯常驻' : '绿灯关键词') }),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 70,
    render: (row: { enabled: boolean }) =>
      h(NTag, { size: 'tiny', type: row.enabled ? 'default' : 'error', bordered: false }, { default: () => (row.enabled ? '启用' : '禁用') }),
  },
  { title: '顺序', key: 'order', width: 60 },
  {
    title: '操作',
    key: 'ops',
    width: 90,
    render: (row: { i: number }) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(NButton, { size: 'tiny', tertiary: true, onClick: () => openEntry(row.i) }, { default: () => '编辑' }),
          h(NPopconfirm, { onPositiveClick: () => removeEntry(row.i) }, {
            trigger: () => h(NButton, { size: 'tiny', tertiary: true, type: 'error' }, { default: () => '删' }),
            default: () => '删除条目？',
          }),
        ],
      }),
  },
];

/* ---------------- ST 全局世界书互导 ---------------- */

async function exportWorldInfo() {
  const wi = characterBookToWorldInfo(book.value);
  const path = await downloadText(JSON.stringify({ entries: wi.entries, name: book.value.name ?? props.card.data.name }, null, 2), `${book.value.name || props.card.data.name}-世界书.json`);
  message.success(path ? `已导出 ST 全局世界书 JSON：${path}` : '已导出 ST 全局世界书 JSON');
}

async function importWorldInfo() {
  const files = await pickJsonFiles();
  if (!files.length) return;
  try {
    const raw = JSON.parse(await files[0]!.text()) as { entries?: unknown };
    if (!raw.entries) throw new Error('JSON 中没有 entries 字段（不是 ST 世界书？）');
    const converted = worldInfoToCharacterBook(raw as unknown as Parameters<typeof worldInfoToCharacterBook>[0]);
    mutate((arr) => arr.push(...converted.entries));
    message.success(`导入 ${converted.entries.length} 条世界书条目`);
  } catch (e) {
    message.error((e as Error).message);
  }
}

const editingEntry = computed(() => (editing.value !== null ? book.value.entries[editing.value] : null));

function patchEntry(patch: Partial<BookEntry>) {
  if (editing.value === null) return;
  mutate((arr) => {
    arr[editing.value!] = { ...arr[editing.value!]!, ...patch };
  });
}
</script>

<template>
  <div>
    <NCollapse style="margin-bottom: 12px" :default-expanded-names="[]">
      <NCollapseItem name="batch">
        <template #header>
          <NSpace align="center" :size="6">
            <NIcon size="15"><SparklesOutline /></NIcon>
            <span style="font-weight: 600">AI 批量生成</span>
            <NText depth="3" style="font-size: 12px; font-weight: 400">按世界观批量生成条目（分批防截断 · 评审后注入）</NText>
          </NSpace>
        </template>
        <WbBatchPanel :card="card" @change="emit('change')" />
      </NCollapseItem>
      <NCollapseItem name="novel">
        <template #header>
          <NSpace align="center" :size="6">
            <NIcon size="15"><BookOutline /></NIcon>
            <span style="font-weight: 600">小说提取（5 类轨迹）</span>
            <NText depth="3" style="font-size: 12px; font-weight: 400">角色/事件线/时间线/设定/物品 · 断点续跑</NText>
          </NSpace>
        </template>
        <WbNovelPanel :card="card" @change="emit('change')" />
      </NCollapseItem>
    </NCollapse>

    <NSpace :size="8" style="margin-bottom: 10px" align="center">
      <NButton size="small" type="primary" @click="addEntry">
        <template #icon><NIcon><AddOutline /></NIcon></template>添加条目
      </NButton>
      <NButton size="small" secondary @click="importWorldInfo">
        <template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入 ST 世界书
      </NButton>
      <NButton size="small" secondary @click="exportWorldInfo">
        <template #icon><NIcon><DownloadOutline /></NIcon></template>导出 ST 世界书
      </NButton>
      <NText depth="3" style="font-size: 12px">共 {{ book.entries.length }} 条 · ST 专属字段（递归/概率/深度等）保存在条目 extensions 中，互转不丢失</NText>
    </NSpace>

    <NDataTable :columns="columns" :data="rows" size="small" :bordered="false" :row-key="(r: { i: number }) => r.i" />

    <NDrawer v-model:show="drawerOpen" :width="560" placement="right">
      <NDrawerContent :title="editingEntry ? `条目：${editingEntry.comment || '（无备注）'}` : '条目'">
        <NForm v-if="editingEntry" label-placement="top" size="small">
          <NFormItem label="备注（条目名）">
            <NInput :value="editingEntry.comment" @update:value="(v: string) => patchEntry({ comment: v })" />
          </NFormItem>
          <div class="field-row">
            <NFormItem label="关键词（keys）">
              <NDynamicTags :value="editingEntry.keys" @update:value="(v: string[]) => patchEntry({ keys: v })" />
            </NFormItem>
            <NFormItem>
              <template #label>副关键词（AND 逻辑）</template>
              <NDynamicTags :value="editingEntry.secondary_keys" @update:value="(v: string[]) => patchEntry({ secondary_keys: v })" />
            </NFormItem>
          </div>
          <div class="field-row">
            <NFormItem label="常驻蓝灯（constant）">
              <NSwitch :value="editingEntry.constant" @update:value="(v: boolean) => patchEntry({ constant: v })" />
            </NFormItem>
            <NFormItem label="启用">
              <NSwitch :value="editingEntry.enabled" @update:value="(v: boolean) => patchEntry({ enabled: v })" />
            </NFormItem>
            <NFormItem label="注入顺序">
              <NInputNumber :value="editingEntry.insertion_order" @update:value="(v: number | null) => patchEntry({ insertion_order: v ?? 100 })" />
            </NFormItem>
            <NFormItem label="位置">
              <NSelect :value="editingEntry.position" :options="POSITION_OPTIONS" @update:value="(v: 'before_char' | 'after_char') => patchEntry({ position: v })" />
            </NFormItem>
          </div>
          <NFormItem>
            <template #label>
              <NSpace align="center" :size="8">
                <span>内容</span>
                <TokenBadge :text="editingEntry.content" :warn-at="800" />
                <FieldAiButton field="worldbook_entry" field-label="世界书条目" :model-value="editingEntry.content" :card="card"
                  @update:model-value="(v: string) => patchEntry({ content: v })" />
              </NSpace>
            </template>
            <NInput type="textarea" :rows="14" :value="editingEntry.content" @update:value="(v: string) => patchEntry({ content: v })" />
          </NFormItem>
        </NForm>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 12px; }
</style>
