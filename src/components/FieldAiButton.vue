<script setup lang="ts">
/**
 * 字段级 AI 按钮：生成 / 优化 / 翻译（提示词来自内置提示词库，可换自定义模板）。
 * 生成 = 按卡片上下文从零写（需要模板，内容可为空）；
 * 优化 = 改写当前内容（模板可选：无模板时把当前内容原文作为提示词直接优化）；
 * 翻译 = 目标语言。
 */
import { ref, computed } from 'vue';
import { NButton, NButtonGroup, NPopselect, NIcon, useMessage } from 'naive-ui';
import { SparklesOutline, ColorWandOutline, LanguageOutline } from '@vicons/ionicons5';
import type { AnyCard } from '@/core/card';
import { runFieldAi } from '@/services/aiService';
import { findPrompt as lookupPrompt } from '@/services/promptLookup';
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

/** 同步查找：仅限调用方显式注入的模板行 */
function findPromptSync(target: string): PromptPayload | null {
  const row = promptRows.value.find((r) => r.kind === 'prompt' && (r.payload as PromptPayload).target === target);
  return row ? (row.payload as PromptPayload) : null;
}

/** 三级查找：注入的模板行 → 内置/自定义提示词库 → description 字段兜底 */
async function findPrompt(target: string, fallbackTarget?: string): Promise<PromptPayload | null> {
  const direct = findPromptSync(target);
  if (direct) return direct;
  const looked = await lookupPrompt(target).catch(() => null);
  if (looked) return looked;
  if (fallbackTarget && fallbackTarget !== target) {
    return (await lookupPrompt(fallbackTarget).catch(() => null)) ?? findPromptSync(fallbackTarget);
  }
  return null;
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
  const fallback = mode === 'translate' ? 'field:*.translate' : `field:description.${mode}`;
  const prompt = await findPrompt(target, fallback);
  let systemPrompt: string;
  let userPrompt: string;
  if (prompt) {
    systemPrompt = prompt.system;
    userPrompt = fill(prompt.userTemplate);
  } else if (mode === 'optimize') {
    // 优化允许无模板：人工填写的内容本身就是提示词
    systemPrompt = `你是资深 SillyTavern 角色卡作家。用户会给出一段角色卡内容，直接优化它：保持原意与信息不丢失，提升具体性与可演绎性，用事件与细节代替空泛形容词；保留 {{user}}/{{char}} 宏与 HTML 标签；保持原文语言；直接输出优化后的正文，不要任何解释。`;
    userPrompt = props.modelValue;
  } else {
    message.error(`未找到「${mode === 'generate' ? 'AI 生成' : '翻译'}」模板（field:${props.field}.${mode}），可在模板中心-提示词库检查`);
    return;
  }
  busy.value = mode;
  streaming.value = '';
  try {
    const out = await runFieldAi({
      feature: `${props.field}:${mode}`,
      systemPrompt,
      userPrompt,
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
