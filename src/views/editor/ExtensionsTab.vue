<script setup lang="ts">
/** 扩展 Tab：depth_prompt / talkativeness / world / 原始 JSON 编辑 */
import { computed, ref, watch } from 'vue';
import {
  NSpace, NFormItem, NInput, NInputNumber, NSelect, NSwitch, NTag, useMessage, NTabs, NTab,
} from 'naive-ui';
import type { AnyCard } from '@/core/card';
import CodeEditor from '@/components/CodeEditor.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const ext = computed(() => (data.value.extensions ?? {}) as Record<string, unknown>);
const depth = computed(
  () => (ext.value.depth_prompt ?? { prompt: '', depth: 4, role: 'system' }) as { prompt: string; depth: number; role: 'system' | 'user' | 'assistant' },
);

function setDepth(p: Partial<{ prompt: string; depth: number; role: string }>) {
  data.value.extensions = { ...ext.value, depth_prompt: { ...depth.value, ...p } };
  emit('change');
}

function setExtKey(key: string, v: unknown) {
  data.value.extensions = { ...ext.value, [key]: v };
  emit('change');
}

/* 原始 JSON 编辑（带合法性校验） */
const rawJson = ref('');
const rawTab = ref<'form' | 'raw'>('form');
watch(rawTab, (t) => {
  if (t === 'raw') rawJson.value = JSON.stringify(props.card, null, 2);
});
const rawError = ref('');

function applyRaw() {
  try {
    const parsed = JSON.parse(rawJson.value) as Record<string, unknown>;
    // 语法之外再做最小形状校验：缺 data 块或 entries 非数组的 JSON 会让编辑器其他 Tab 崩溃
    const problems: string[] = [];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push('根节点必须是对象');
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) problems.push('缺少 data 对象');
    const book = (parsed.data as Record<string, unknown> | undefined)?.character_book as { entries?: unknown } | undefined;
    if (book !== undefined && (!book.entries || !Array.isArray(book.entries))) problems.push('character_book.entries 必须是数组');
    if (problems.length) {
      rawError.value = problems.join('；');
      return;
    }
    // 原地替换 card 内容
    const target = props.card as unknown as Record<string, unknown>;
    Object.keys(target).forEach((k) => delete target[k]);
    Object.assign(target, parsed);
    rawError.value = '';
    emit('change');
    message.success('JSON 已应用（记得保存）');
  } catch (e) {
    rawError.value = (e as Error).message;
  }
}

const ROLE_OPTIONS = [
  { label: 'system', value: 'system' },
  { label: 'user', value: 'user' },
  { label: 'assistant', value: 'assistant' },
];
</script>

<template>
  <NTabs v-model:value="rawTab" type="segment" size="small">
    <NTab name="form" tab="表单">
      <NSpace vertical :size="14" style="max-width: 760px">
        <NFormItem label="depth_prompt（深度注入的提示，随对话深度生效）">
          <div class="field-block">
            <NInput type="textarea" :rows="4" :value="depth.prompt" @update:value="(v: string) => setDepth({ prompt: v })" />
            <NSpace :size="12" style="margin-top: 8px" align="center">
              <span style="font-size: 12px; opacity: .7">深度</span>
              <NInputNumber size="small" :value="depth.depth" :min="0" :max="99" @update:value="(v: number | null) => setDepth({ depth: v ?? 4 })" />
              <span style="font-size: 12px; opacity: .7">角色</span>
              <NSelect size="small" :value="depth.role" :options="ROLE_OPTIONS" style="width: 120px"
                @update:value="(v: string) => setDepth({ role: v })" />
            </NSpace>
          </div>
        </NFormItem>

        <div class="field-row">
          <NFormItem label="talkativeness（群聊主动发言倾向）">
            <NInputNumber size="small" :value="Number(ext.talkativeness ?? 0.5)" :min="0" :max="1" :step="0.1"
              @update:value="(v: number | null) => setExtKey('talkativeness', v ?? 0.5)" />
          </NFormItem>
          <NFormItem label="fav（收藏）">
            <NSwitch :value="Boolean(ext.fav)" @update:value="(v: boolean) => setExtKey('fav', v)" />
          </NFormItem>
          <NFormItem label="world（关联全局世界书名）">
            <NInput :value="String(ext.world ?? '')" @update:value="(v: string) => setExtKey('world', v)" placeholder="留空使用内嵌 character_book" />
          </NFormItem>
        </div>

        <NTag :bordered="false" type="info">
          正则脚本在「正则」页编辑；助手脚本在「脚本」页编辑；其余扩展字段用右侧原始 JSON 编辑
        </NTag>
      </NSpace>
    </NTab>
    <NTab name="raw" tab="原始 JSON">
      <NSpace vertical :size="8">
        <CodeEditor v-model="rawJson" language="javascript" height="480px" />
        <NSpace align="center">
          <button class="raw-apply" @click="applyRaw">应用 JSON</button>
          <span v-if="rawError" style="color: var(--tcs-bad, #f87171); font-size: 12px">{{ rawError }}</span>
        </NSpace>
      </NSpace>
    </NTab>
  </NTabs>
</template>

<style scoped>
.field-block { width: 100%; }
.field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0 14px; }
.raw-apply {
  background: var(--tcs-accent, #8b5cf6); color: #fff; border: none; border-radius: 6px;
  padding: 5px 14px; cursor: pointer; font-size: 13px;
}
.raw-apply:hover { background: var(--tcs-accent-hover, #a78bfa); }
</style>
