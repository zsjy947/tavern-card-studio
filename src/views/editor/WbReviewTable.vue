<script setup lang="ts">
/**
 * 世界书生成/提取共用评审表：勾选、类型徽标、单条重生成（批量生成用）、内容预览折叠。
 * 结果先入评审表，用户勾选后才注入卡内（朔规则由调用方负责）。
 */
import { h, ref, computed } from 'vue';
import { NButton, NCheckbox, NDataTable, NTag, NSpace, NTooltip } from 'naive-ui';
import { RefreshOutline } from '@vicons/ionicons5';

export interface WbReviewRow {
  key: string;
  comment: string;
  keys: string[];
  content: string;
  constant: boolean;
  /** 类型徽标文案（角色/事件线/主线/设定·功法…；可空） */
  tag?: string;
}

const props = defineProps<{ rows: WbReviewRow[] }>();
const checked = defineModel<string[]>({ default: () => [] });

const emit = defineEmits<{ regen: [key: string] }>();

function toggle(key: string, val: boolean) {
  const set = new Set(checked.value);
  if (val) set.add(key);
  else set.delete(key);
  checked.value = [...set];
}

function toggleAll(val: boolean) {
  checked.value = val ? props.rows.map((r) => r.key) : [];
}

const allChecked = computed(() => props.rows.length > 0 && checked.value.length === props.rows.length);

const expanded = ref<string | null>(null);

const columns = [
  {
    title: '',
    key: 'check',
    width: 44,
    render: (row: WbReviewRow) =>
      h(NCheckbox, { checked: checked.value.includes(row.key), 'onUpdate:checked': (v: boolean) => toggle(row.key, v) }),
  },
  {
    title: '条目名',
    key: 'comment',
    ellipsis: { tooltip: true },
    render: (row: WbReviewRow) =>
      h('a', { style: 'cursor:pointer;font-weight:600', onClick: () => (expanded.value = expanded.value === row.key ? null : row.key) }, row.comment),
  },
  {
    title: '类型',
    key: 'tag',
    width: 110,
    render: (row: WbReviewRow) =>
      row.tag
        ? h(NTag, { size: 'tiny', bordered: false, type: row.constant ? 'success' : 'info' }, { default: () => row.tag })
        : h(NTag, { size: 'tiny', bordered: false, type: row.constant ? 'success' : 'info' }, { default: () => (row.constant ? '蓝灯常驻' : '绿灯触发') }),
  },
  { title: '关键词', key: 'keys', width: 180, ellipsis: { tooltip: true }, render: (row: WbReviewRow) => h('span', { style: 'font-size:12px;opacity:.75' }, row.keys.join('、') || '—') },
  {
    title: '操作',
    key: 'ops',
    width: 110,
    render: (row: WbReviewRow) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(NTooltip, null, {
            trigger: () => h(NButton, { size: 'tiny', tertiary: true, onClick: () => emit('regen', row.key) }, { icon: () => h(RefreshOutline) }),
            default: () => '单条重生成（保持类型定位）',
          }),
        ],
      }),
  },
];
</script>

<template>
  <div>
    <NSpace align="center" :size="8" style="margin-bottom: 6px">
      <NCheckbox :checked="allChecked" @update:checked="toggleAll">全选（{{ checked.length }}/{{ rows.length }}）</NCheckbox>
    </NSpace>
    <NDataTable :columns="columns" :data="rows" size="small" :bordered="false" :max-height="320" :row-key="(r: WbReviewRow) => r.key" />
    <pre v-if="expanded" class="wb-review-content">{{ rows.find((r) => r.key === expanded)?.content }}</pre>
  </div>
</template>

<style scoped>
.wb-review-content {
  background: var(--tcs-surface-2, rgba(127,127,127,.08));
  border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.55;
  max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin-top: 6px;
}
</style>
