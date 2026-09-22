<script setup lang="ts">
/** 完整生成向导：选模板 → 基础设定 → 分步生成整卡（每步人工确认） */
import { computed, onMounted, ref } from 'vue';
import {
  NSpace, NButton, NStep, NSteps, NInput, NTag, useMessage, NCard, NIcon, NRadioGroup, NRadioButton, NEmpty,
} from 'naive-ui';
import { SparklesOutline, CheckmarkOutline, ArrowForwardOutline } from '@vicons/ionicons5';
import { listTemplates, getTemplate } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { CardTemplatePayload } from '@/builtins/cardTemplates';
import type { PromptPayload } from '@/builtins/promptTemplates';
import { blankCard } from '@/core/card';
import * as cardService from '@/services/cardService';
import { runFieldAi } from '@/services/aiService';
import { useWorkspace } from '@/stores/workspace';
import { useRouter } from 'vue-router';

const message = useMessage();
const router = useRouter();
const ws = useWorkspace();

const step = ref(1);
const templates = ref<TemplateRow[]>([]);
const chosenTemplateId = ref<string | null>(null);
const cardName = ref('');
const brief = ref('');
const extra = ref('');
const autoMode = ref<'semi' | 'auto'>('semi');

/** 每步产物：field → 内容 */
const outputs = ref<Record<string, string>>({});
const busy = ref('');
const briefExpanded = ref('');
const draftTags = ref<string[]>([]);

onMounted(async () => {
  templates.value = await listTemplates('card');
});

const chosen = computed(() => templates.value.find((t) => t.id === chosenTemplateId.value) ?? null);
const payload = computed<CardTemplatePayload | null>(() => (chosen.value?.payload as CardTemplatePayload) ?? null);

/** 生成顺序：模板 fields 里支持的生成字段 */
const GEN_ORDER = ['description', 'personality', 'scenario', 'mes_example', 'first_mes'];

const genFields = computed(() => {
  if (!payload.value) return [];
  return payload.value.fields
    .filter((f) => GEN_ORDER.includes(f.key) && f.key !== 'name' && f.key !== 'tags')
    .sort((a, b) => GEN_ORDER.indexOf(a.key) - GEN_ORDER.indexOf(b.key));
});

const progressLabel = computed(() => `${genFields.value.findIndex((f) => !outputs.value[f.key]) + 1 > 0 ? '进行中' : '完成'} · ${Object.keys(outputs).length}/${genFields.value.length}`);

async function findPrompt(target: string): Promise<PromptPayload | null> {
  const rows = await listTemplates('prompt');
  const row = rows.find((r) => (r.payload as PromptPayload).target === target);
  return row ? (row.payload as PromptPayload) : null;
}

function contextText(): string {
  const parts = [`角色名：${cardName.value}`];
  if (briefExpanded.value) parts.push(`设定：\n${briefExpanded.value}`);
  for (const f of genFields.value) {
    if (outputs.value[f.key]) parts.push(`${f.label}：\n${outputs.value[f.key]}`);
  }
  return parts.join('\n\n');
}

async function expandBrief() {
  if (!cardName.value.trim() || !brief.value.trim()) {
    message.error('先填角色名与一句话设定');
    return;
  }
  const p = await findPrompt('wizard:brief');
  if (!p) return;
  busy.value = 'brief';
  try {
    briefExpanded.value = await runFieldAi({
      feature: '向导:设定扩写',
      systemPrompt: p.system,
      userPrompt: p.userTemplate.replaceAll('{NAME}', cardName.value).replaceAll('{BRIEF}', brief.value).replaceAll('{EXTRA}', extra.value || '无'),
    });
    message.success('设定已扩写，检查后继续');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function genField(key: string, label: string) {
  if (!briefExpanded.value && autoMode.value === 'semi') {
    message.warning('建议先扩写设定');
  }
  const p = await findPrompt(`field:${key}.generate`) ?? await findPrompt('field:description.generate');
  if (!p) return;
  busy.value = key;
  try {
    outputs.value[key] = await runFieldAi({
      feature: `向导:${key}`,
      systemPrompt: p.system,
      userPrompt: p.userTemplate
        .replaceAll('{FIELD_LABEL}', label)
        .replaceAll('{FIELD_GUIDE}', payload.value?.fields.find((f) => f.key === key)?.hint ?? '')
        .replaceAll('{NAME}', cardName.value)
        .replaceAll('{CONTEXT}', contextText()),
    });
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function genAll() {
  for (const f of genFields.value) {
    if (outputs.value[f.key]) continue;
    // eslint-disable-next-line no-await-in-loop
    await genField(f.key, f.label);
  }
  message.success('全部生成完毕，请逐项确认');
}

const canFinish = computed(() => cardName.value && outputs.value.first_mes && outputs.value.description);

async function finish() {
  if (!canFinish.value) {
    message.error('至少需要角色名、描述与开场白');
    return;
  }
  const card = blankCard(cardName.value);
  const d = card.data as Record<string, unknown>;
  for (const [k, v] of Object.entries(outputs.value)) d[k] = v;
  d.tags = [...(payload.value?.defaultTags ?? []), ...draftTags.value];
  const row = await cardService.createCard(cardName.value, card);
  await ws.refreshCards(true);
  message.success('整卡已生成并入库，去编辑器检查');
  router.push(`/editor/${row.id}`);
}
</script>

<template>
  <div style="max-width: 920px; margin: 0 auto">
    <NSteps :current="step" size="small" style="margin-bottom: 20px">
      <NStep title="选模板" />
      <NStep title="基础设定" />
      <NStep title="分步生成" />
      <NStep title="完成" />
    </NSteps>

    <!-- 步骤 1：模板 -->
    <NCard v-if="step === 1" title="选择卡片模板" size="small">
      <NSpace :size="10" wrap>
        <div
          v-for="t in templates" :key="t.id" class="wiz-tpl"
          :class="{ 'wiz-tpl-active': chosenTemplateId === t.id }"
          @click="chosenTemplateId = t.id"
        >
          <b>{{ t.name }}</b>
          <span class="wiz-tpl-desc">{{ t.description }}</span>
          <NTag size="tiny" :bordered="false">{{ (t.payload as CardTemplatePayload).spec.toUpperCase() }}</NTag>
        </div>
      </NSpace>
      <template #action>
        <NSpace justify="space-between">
          <NTag :bordered="false" type="info">小白推荐「精简人设」，四步出卡</NTag>
          <NButton type="primary" size="small" :disabled="!chosenTemplateId" @click="step = 2">
            下一步<template #icon><NIcon><ArrowForwardOutline /></NIcon></template>
          </NButton>
        </NSpace>
      </template>
    </NCard>

    <!-- 步骤 2：基础设定 -->
    <NCard v-else-if="step === 2" :title="`基础设定 · ${chosen?.name ?? ''}`" size="small">
      <NSpace vertical :size="12">
        <NSpace :size="10" align="center">
          <NInput v-model:value="cardName" placeholder="角色名" style="width: 200px" />
          <NRadioGroup v-model:value="autoMode" size="small">
            <NRadioButton value="semi">半自动（每步确认）</NRadioButton>
            <NRadioButton value="auto">全自动</NRadioButton>
          </NRadioGroup>
        </NSpace>
        <NInput v-model:value="brief" type="textarea" :rows="3" placeholder="一句话设定：她是你的青梅竹马，表面毒舌实则黏人……（越具体，生成质量越高）" />
        <NInput v-model:value="extra" type="textarea" :rows="2" placeholder="补充要求（可选）：文风、雷点、必须包含的元素…" />
        <NSpace>
          <NButton size="small" type="primary" :loading="busy === 'brief'" @click="expandBrief">
            <template #icon><NIcon><SparklesOutline /></NIcon></template>AI 扩写设定
          </NButton>
        </NSpace>
        <NInput v-if="briefExpanded" v-model:value="briefExpanded" type="textarea" :rows="10" />
      </NSpace>
      <template #action>
        <NSpace justify="space-between">
          <NButton size="small" @click="step = 1">上一步</NButton>
          <NButton type="primary" size="small" :disabled="!cardName || !brief" @click="step = 3">下一步</NButton>
        </NSpace>
      </template>
    </NCard>

    <!-- 步骤 3：分步生成 -->
    <NCard v-else-if="step === 3" :title="`分步生成 · ${progressLabel}`" size="small">
      <NSpace vertical :size="14">
        <NSpace>
          <NButton size="small" type="primary" @click="genAll" :loading="!!busy">一键全部生成</NButton>
          <NTag :bordered="false">生成顺序：{{ genFields.map((f) => f.label).join(' → ') }}（后面的步骤引用前面产物）</NTag>
        </NSpace>
        <NEmpty v-if="!genFields.length" description="模板没有可生成字段" />
        <div v-for="f in genFields" :key="f.key" class="wiz-step">
          <div class="wiz-step-head">
            <b>{{ f.label }}</b>
            <NTag v-if="outputs[f.key]" size="tiny" type="success" round :bordered="false">已生成</NTag>
            <span class="wiz-step-hint">{{ f.hint }}</span>
            <NButton size="tiny" secondary :loading="busy === f.key" style="margin-left: auto"
              @click="genField(f.key, f.label)">
              {{ outputs[f.key] ? '重新生成' : '生成' }}
            </NButton>
          </div>
          <NInput v-if="outputs[f.key]" v-model:value="outputs[f.key]!" type="textarea" :rows="6" />
        </div>
      </NSpace>
      <template #action>
        <NSpace justify="space-between">
          <NButton size="small" @click="step = 2">上一步</NButton>
          <NButton type="primary" size="small" :disabled="!canFinish" @click="finish">
            <template #icon><NIcon><CheckmarkOutline /></NIcon></template>生成整卡并入库
          </NButton>
        </NSpace>
      </template>
    </NCard>
  </div>
</template>

<style scoped>
.wiz-tpl {
  width: 200px; padding: 12px 14px; border-radius: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03);
  display: flex; flex-direction: column; gap: 6px; transition: all .15s;
}
.wiz-tpl:hover { border-color: rgba(139,92,246,.5); }
.wiz-tpl-active { border-color: #8b5cf6; background: rgba(139,92,246,.1); }
.wiz-tpl-desc { font-size: 12px; opacity: .7; line-height: 1.5; }
.wiz-step { border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px 12px; }
.wiz-step-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.wiz-step-hint { font-size: 12px; opacity: .6; }
</style>
