<script setup lang="ts">
/**
 * 字段级 AI 按钮：生成 / 优化 / 翻译（提示词来自内置提示词库，可换自定义模板）。
 * 生成 = 按卡片上下文从零写；优化 = 改写当前内容；翻译 = 目标语言。
 */
import { ref, computed } from 'vue';
import { NButton, NButtonGroup, NPopselect, NIcon, useMessage } from 'naive-ui';
import { SparklesOutline, ColorWandOutline, LanguageOutline } from '@vicons/ionicons5';
import type { AnyCard } from '@/core/card';
import { runFieldAi } from '@/services/aiService';
import type { TemplateRow } from '@/services/types';
import type { PromptPayload } from '@/builtins/promptTemplates';

const props = defineProps<{
  field: string;
  fieldLabel?: string;
  modelValue: string;
  card?: AnyCard | null;
  charName?: string;
  prompts?: TemplateRow[];
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const message = useMessage();
const busy = ref<'' | 'generate' | 'optimize' | 'translate'>('');
const streaming = ref('');
const targetLang = ref('English');

const promptRows = computed<TemplateRow[]>(() => props.prompts ?? []);

function cardContext(): string {
  if (!props.card) return props.modelValue;
  const d = props.card.data as Record<string, unknown>;
  const brief = (k: string) => (k === props.field ? undefined : `${k}: ${String(d[k] ?? '').slice(0, 800)}`);
  return ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example']
    .map(brief)
    .filter(Boolean)
    .join('\n\n');
}

function findPrompt(target: string): PromptPayload | null {
  const row = promptRows.value.find((r) => r.kind === 'prompt' && (r.payload as PromptPayload).target === target);
  return row ? (row.payload as PromptPayload) : null;
}

function fill(template: string): string {
  return template
    .replaceAll('{TEXT}', props.modelValue || '（当前为空）')
    .replaceAll('{NAME}', props.charName ?? String((props.card?.data as { name?: string } | undefined)?.name ?? props.charName ?? ''))
    .replaceAll('{CONTEXT}', cardContext() || '（无额外设定）')
    .replaceAll('{FIELD_LABEL}', props.fieldLabel ?? props.field)
    .replaceAll('{FIELD_GUIDE}', '')
    .replaceAll('{TARGET_LANG}', targetLang.value);
}

async function run(mode: 'generate' | 'optimize' | 'translate') {
  if (busy.value) return;
  const target = mode === 'translate' ? 'field:*.translate' : `field:${props.field}.${mode}`;
  const prompt = findPrompt(target) ?? findPrompt(mode === 'translate' ? 'field:*.translate' : `field:description.${mode}`);
  if (!prompt) {
    message.error('未找到对应提示词模板');
    return;
  }
  busy.value = mode;
  streaming.value = '';
  try {
    const out = await runFieldAi({
      feature: `${props.field}:${mode}`,
      systemPrompt: prompt.system,
      userPrompt: fill(prompt.userTemplate),
      onDelta: (_d, full) => {
        streaming.value = full;
      },
    });
    const text = out.trim();
    if (!text) {
      message.warning('AI 返回为空');
      return;
    }
    emit('update:modelValue', text);
    message.success(`${props.fieldLabel ?? props.field} 已更新（建议先看 diff 再保存）`);
  } catch (e) {
    message.error(`AI 调用失败：${(e as Error).message}`);
  } finally {
    busy.value = '';
    streaming.value = '';
  }
}

const langOptions = ['English', '简体中文', '繁體中文', '日本語', '한국어'];
</script>

<template>
  <div class="field-ai">
    <NButtonGroup size="tiny">
      <NButton size="tiny" secondary :loading="busy === 'generate'" :disabled="!!busy" @click="run('generate')">
        <template #icon><NIcon><SparklesOutline /></NIcon></template>
        AI 生成
      </NButton>
      <NButton size="tiny" secondary :loading="busy === 'optimize'" :disabled="!!busy || !modelValue" @click="run('optimize')">
        <template #icon><NIcon><ColorWandOutline /></NIcon></template>
        优化
      </NButton>
      <NPopselect v-model:value="targetLang" :options="langOptions.map((l) => ({ label: l, value: l }))" trigger="click" @update:value="run('translate')">
        <NButton size="tiny" secondary :loading="busy === 'translate'" :disabled="!!busy || !modelValue">
          <template #icon><NIcon><LanguageOutline /></NIcon></template>
          翻译
        </NButton>
      </NPopselect>
    </NButtonGroup>
    <span v-if="streaming" class="field-ai-streaming">生成中…</span>
  </div>
</template>

<style scoped>
.field-ai { display: inline-flex; align-items: center; gap: 8px; }
.field-ai-streaming { font-size: 12px; opacity: .6; }
</style>
