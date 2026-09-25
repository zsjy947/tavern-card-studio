<script setup lang="ts">
/** 完整生成向导：选模板 → 基础设定 → 字段工作台（手填与 AI 生成等价）→ 完成入库 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NStep, NSteps, NInput, NTag, useMessage, NCard, NIcon, NRadioGroup, NRadioButton, NEmpty, NDynamicTags,
} from 'naive-ui';
import { SparklesOutline, CheckmarkOutline, ArrowForwardOutline, AddOutline, TrashOutline } from '@vicons/ionicons5';
import { listTemplates } from '@/services/templateService';
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

/** 每步产物：field → 内容（手填与 AI 生成统一收集） */
const outputs = ref<Record<string, string>>({});
const busy = ref('');
const briefExpanded = ref('');
const draftTags = ref<string[]>([]);
/** 自定义字段（key → label），finish 时逐 key 直写 card.data */
const customFields = ref<{ key: string; label: string }[]>([]);
const newFieldKey = ref('');
const newFieldLabel = ref('');
const autoRan = ref(false);

onMounted(async () => {
  templates.value = await listTemplates('card');
});

const chosen = computed(() => templates.value.find((t) => t.id === chosenTemplateId.value) ?? null);
const payload = computed<CardTemplatePayload | null>(() => (chosen.value?.payload as CardTemplatePayload) ?? null);

/** 生成顺序：模板 fields 里支持的生成字段 */
const GEN_ORDER = ['description', 'personality', 'scenario', 'mes_example', 'first_mes'];
/** 卡片顶层结构保留字，禁止用作自定义字段 key */
const RESERVED_KEYS = new Set(['spec', 'spec_version', 'data', 'create', 'extensions']);
const FIELD_KEY_RE = /^[a-z_][a-z0-9_]*$/;

const genFields = computed(() => {
  if (!payload.value || !Array.isArray(payload.value.fields)) return [];
  return payload.value.fields
    .filter((f) => GEN_ORDER.includes(f.key) && f.key !== 'name' && f.key !== 'tags')
    .sort((a, b) => GEN_ORDER.indexOf(a.key) - GEN_ORDER.indexOf(b.key));
});

/** 非生成类字段（creator/character_version/system_prompt 等）：常驻手填 */
const metaFields = computed(() => {
  if (!payload.value || !Array.isArray(payload.value.fields)) return [];
  return payload.value.fields.filter((f) => f.key !== 'name' && f.key !== 'tags' && !GEN_ORDER.includes(f.key));
});

// 切换模板 → 重置工作台并预填空串，保证 textarea 可直接 v-model
watch(chosenTemplateId, () => {
  outputs.value = {};
  customFields.value = [];
  draftTags.value = [...(payload.value?.defaultTags ?? [])];
  autoRan.value = false;
  for (const f of [...genFields.value, ...metaFields.value]) outputs.value[f.key] = '';
});

const filledCount = computed(() => genFields.value.filter((f) => outputs.value[f.key]?.trim()).length);
const progressLabel = computed(() => `${filledCount.value === genFields.value.length && genFields.value.length > 0 ? '完成' : '进行中'} · ${filledCount.value}/${genFields.value.length}`);

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
  if (busy.value) {
    message.warning('已有生成任务进行中，请等待完成');
    return;
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
    if (outputs.value[f.key]?.trim()) continue;
    // eslint-disable-next-line no-await-in-loop
    await genField(f.key, f.label);
  }
  message.success('全部生成完毕，请逐项确认');
}

function addCustomField() {
  const key = newFieldKey.value.trim();
  const label = newFieldLabel.value.trim() || key;
  if (!FIELD_KEY_RE.test(key)) {
    message.error('字段 key 需为小写字母/下划线开头，仅含小写字母、数字、下划线');
    return;
  }
  if (RESERVED_KEYS.has(key)) {
    message.error(`「${key}」是卡片结构保留字，不能使用`);
    return;
  }
  const taken = new Set([...(payload.value?.fields ?? []).map((f) => f.key), ...customFields.value.map((f) => f.key)]);
  if (taken.has(key)) {
    message.error(`字段 key「${key}」已存在`);
    return;
  }
  customFields.value.push({ key, label });
  outputs.value[key] = outputs.value[key] ?? '';
  newFieldKey.value = '';
  newFieldLabel.value = '';
}

function removeCustomField(key: string) {
  customFields.value = customFields.value.filter((f) => f.key !== key);
  delete outputs.value[key];
}

/** canFinish 放宽：手填与 AI 生成等价，三项有值即可入库 */
const canFinish = computed(() => Boolean(cardName.value.trim() && outputs.value.description?.trim() && outputs.value.first_mes?.trim()));

function enterStep3() {
  step.value = 3;
  // 全自动模式：进入工作台即自动补齐空字段（只填空值，不覆盖手填）
  if (autoMode.value === 'auto' && !autoRan.value) {
    autoRan.value = true;
    void genAll();
  }
}

async function finish() {
  if (!canFinish.value) {
    message.error('至少需要角色名、描述与开场白（手填或 AI 生成均可）');
    return;
  }
  const card = blankCard(cardName.value.trim());
  const d = card.data as Record<string, unknown>;
  for (const [k, v] of Object.entries(outputs.value)) {
    if (v.trim()) d[k] = v;
  }
  d.tags = [...new Set([...draftTags.value])];
  const row = await cardService.createCard(cardName.value.trim(), card);
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
          <NTag size="tiny" :bordered="false">{{ String((t.payload as CardTemplatePayload | undefined)?.spec ?? 'v3').toUpperCase() }}</NTag>
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
          <NButton type="primary" size="small" :disabled="!cardName || !brief" @click="enterStep3">下一步</NButton>
        </NSpace>
      </template>
    </NCard>

    <!-- 步骤 3：字段工作台（手填与 AI 生成等价，全部字段常驻可编辑） -->
    <NCard v-else-if="step === 3" :title="`字段工作台 · ${progressLabel}`" size="small">
      <NSpace vertical :size="14">
        <NSpace align="center">
          <NButton size="small" type="primary" @click="genAll" :loading="!!busy" :disabled="!genFields.length">一键生成空缺字段</NButton>
          <NTag :bordered="false" size="small">所有字段可直接手写，AI 生成仅作辅助，生成后仍可修改</NTag>
        </NSpace>
        <NEmpty v-if="!genFields.length && !metaFields.length" description="模板没有字段，可直接添加自定义字段" />
        <div v-for="f in genFields" :key="f.key" class="wiz-step">
          <div class="wiz-step-head">
            <b>{{ f.label }}</b>
            <NTag v-if="outputs[f.key]?.trim()" size="tiny" type="success" round :bordered="false">已填写</NTag>
            <span class="wiz-step-hint">{{ f.hint }}</span>
            <NButton size="tiny" secondary :loading="busy === f.key" style="margin-left: auto" @click="genField(f.key, f.label)">
              <template #icon><NIcon><SparklesOutline /></NIcon></template>
              {{ outputs[f.key]?.trim() ? 'AI 重新生成' : 'AI 生成' }}
            </NButton>
          </div>
          <NInput v-model:value="outputs[f.key]!" type="textarea" :rows="6" :placeholder="`可直接手写${f.label}，或点右上角 AI 生成`" />
        </div>

        <!-- 自定义字段 -->
        <div v-for="f in customFields" :key="f.key" class="wiz-step">
          <div class="wiz-step-head">
            <b>{{ f.label }}</b>
            <NTag size="tiny" :bordered="false">{{ f.key }}</NTag>
            <NButton size="tiny" quaternary type="error" style="margin-left: auto" @click="removeCustomField(f.key)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>移除
            </NButton>
          </div>
          <NInput v-model:value="outputs[f.key]!" type="textarea" :rows="4" placeholder="直接手写内容" />
        </div>

        <!-- 元信息字段 -->
        <div v-if="metaFields.length" class="wiz-step">
          <div class="wiz-step-head"><b>元信息</b></div>
          <NSpace vertical :size="10">
            <div v-for="f in metaFields" :key="f.key" class="wiz-meta-row">
              <span class="wiz-meta-label">{{ f.label }}</span>
              <NInput v-model:value="outputs[f.key]!" :placeholder="f.hint" style="flex: 1" />
            </div>
            <div class="wiz-meta-row">
              <span class="wiz-meta-label">标签</span>
              <NDynamicTags v-model:value="draftTags" style="flex: 1" />
            </div>
          </NSpace>
        </div>

        <!-- 添加自定义字段 -->
        <NSpace align="center" :size="8">
          <NInput v-model:value="newFieldKey" size="small" placeholder="字段 key（如 world_rule）" style="width: 220px" @keyup.enter="addCustomField" />
          <NInput v-model:value="newFieldLabel" size="small" placeholder="显示名（如 世界规则）" style="width: 180px" @keyup.enter="addCustomField" />
          <NButton size="small" secondary @click="addCustomField">
            <template #icon><NIcon><AddOutline /></NIcon></template>添加字段
          </NButton>
        </NSpace>
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
  border: 1px solid var(--tcs-border, rgba(255,255,255,.1)); background: var(--tcs-fill, rgba(255,255,255,.03));
  display: flex; flex-direction: column; gap: 6px; transition: all .15s;
}
.wiz-tpl:hover { border-color: var(--tcs-accent-border, rgba(139,92,246,.5)); }
.wiz-tpl-active { border-color: var(--tcs-accent, #8b5cf6); background: var(--tcs-accent-soft, rgba(139,92,246,.1)); }
.wiz-tpl-desc { font-size: 12px; opacity: .7; line-height: 1.5; }
.wiz-step { border: 1px solid var(--tcs-border, rgba(255,255,255,.07)); border-radius: 10px; padding: 10px 12px; }
.wiz-step-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.wiz-step-hint { font-size: 12px; opacity: .6; }
.wiz-meta-row { display: flex; align-items: center; gap: 10px; }
.wiz-meta-label { font-size: 13px; opacity: .8; width: 90px; flex-shrink: 0; }
</style>
