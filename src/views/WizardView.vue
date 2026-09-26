<script setup lang="ts">
/** 完整生成向导：选模板 → 基础设定 → 字段工作台（手填与 AI 生成等价）→ 完成入库 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NStep, NSteps, NInput, NTag, useMessage, NCard, NIcon, NRadioGroup, NRadioButton, NEmpty, NDynamicTags, NText,
} from 'naive-ui';
import { SparklesOutline, CheckmarkOutline, ArrowForwardOutline, AddOutline, TrashOutline } from '@vicons/ionicons5';
import { listTemplates } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { CardTemplatePayload } from '@/builtins/cardTemplates';
import type { PromptPayload } from '@/builtins/promptTemplates';
import { blankCard } from '@/core/card';
import * as cardService from '@/services/cardService';
import { runFieldAi, runFieldAiJson } from '@/services/aiService';
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

/** 角色成员清单（多人卡）：finish 时生成/写入 character_book.entries */
interface WizardMember {
  name: string;
  role: 'lead' | 'support';
  /** 触发称呼，逗号/顿号分隔 */
  aliases: string;
  /** 世界书条目 YAML 内容（AI 生成或手填） */
  content: string;
}
const members = ref<WizardMember[]>([]);

function addMember() {
  members.value.push({ name: '', role: 'support', aliases: '', content: '' });
}

function removeMember(i: number) {
  members.value.splice(i, 1);
}

interface MemberBookEntry {
  comment?: string;
  keys?: string[];
  content?: string;
  constant?: boolean;
}

function membersBrief(list: WizardMember[]): string {
  return list
    .map((m, i) => `${i + 1}. 名称：${m.name || '（待定）'}｜身份：${m.role === 'lead' ? '主角（与 {{user}} 主要互动）' : '配角'}｜触发称呼：${m.aliases || '无'}`)
    .join('\n');
}

/**
 * 为指定成员（缺省为空缺者）批量生成世界书条目。
 * busyKey 区分入口：顶部一键 = 'members'，单行 = `member:${index}`，互不转圈（仍全局互斥）。
 */
async function genMemberEntries(targets?: WizardMember[], busyKey = 'members') {
  const list = targets ?? members.value.filter((m) => m.name.trim() && !m.content.trim());
  if (!list.length) {
    message.info(targets ? '没有需要生成的成员' : '所有成员都已有条目内容');
    return;
  }
  if (list.some((m) => !m.name.trim())) {
    message.error('先给成员填写名称');
    return;
  }
  if (busy.value) {
    message.warning('已有生成任务进行中，请等待完成');
    return;
  }
  const p = await findPrompt('wizard:worldbook-char');
  if (!p) {
    message.error('缺少「向导 · 角色成员条目」内置提示词');
    return;
  }
  busy.value = busyKey;
  try {
    const entries = await runFieldAiJson<MemberBookEntry[]>({
      feature: '向导:角色成员条目',
      systemPrompt: p.system,
      userPrompt: p.userTemplate
        .replaceAll('{MEMBERS}', membersBrief(list))
        .replaceAll('{CONTEXT}', contextText() + (briefExpanded.value ? `\n\n【扩写设定】\n${briefExpanded.value}` : '')),
      jsonSchemaHint: '[{"comment":"成员名","keys":["称呼"],"content":"YAML","constant":false}]',
    });
    if (!Array.isArray(entries)) throw new Error('生成结果不是 JSON 数组，请重试或手填 YAML');
    let filled = 0;
    for (const m of list) {
      const hit = entries.find((e) => (e.comment ?? '').trim() === m.name.trim())
        ?? entries.find((e) => (e.comment ?? '').includes(m.name.trim()));
      if (hit?.content) {
        m.content = hit.content;
        if (hit.constant !== undefined) m.role = hit.constant ? 'lead' : 'support';
        filled++;
      }
    }
    if (filled) message.success(`已生成 ${filled}/${list.length} 个成员条目，可继续修改`);
    else message.error('生成结果与成员名单匹配失败，请检查成员名称后重试');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

/** 成员条目 → 世界书 entry（主角 constant 蓝灯、配角触发词） */
function memberToEntry(m: WizardMember, id: number): Record<string, unknown> {
  const aliases = m.aliases.split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean);
  const isLead = m.role === 'lead';
  return {
    id,
    keys: isLead ? [] : [...new Set([m.name.trim(), ...aliases])],
    secondary_keys: [],
    comment: m.name.trim(),
    content: m.content,
    constant: isLead,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    use_regex: false,
    extensions: { position: 0, display_index: id, probability: 100, useProbability: true, depth: 4, selectiveLogic: 0 },
  };
}

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

async function genField(key: string, label: string): Promise<boolean> {
  if (busy.value) {
    message.warning('已有生成任务进行中，请等待完成');
    return false;
  }
  const p = await findPrompt(`field:${key}.generate`) ?? await findPrompt('field:description.generate');
  if (!p) return false;
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
    return true;
  } catch (e) {
    message.error((e as Error).message);
    return false;
  } finally {
    busy.value = '';
  }
}

async function genAll() {
  let ok = 0;
  const targets = genFields.value.filter((f) => !outputs.value[f.key]?.trim());
  for (const f of targets) {
    // eslint-disable-next-line no-await-in-loop
    if (await genField(f.key, f.label)) ok++;
  }
  if (ok === targets.length) message.success('全部生成完毕，请逐项确认');
  else if (ok > 0) message.warning(`生成完成 ${ok}/${targets.length}，失败字段可单独重试或手写`);
  // 全部失败时 genField 内已逐项报错，不再追加成功提示
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

const saving = ref(false);

async function finish() {
  if (saving.value) return;
  if (!canFinish.value) {
    message.error('至少需要角色名、描述与开场白（手填或 AI 生成均可）');
    return;
  }
  saving.value = true;
  try {
    const named = members.value.filter((m) => m.name.trim());
    if (named.some((m) => !m.content.trim())) {
      // 有成员但缺条目：入库前补齐（失败则中断，避免半成品卡）
      await genMemberEntries(named.filter((m) => !m.content.trim()));
      if (named.some((m) => !m.content.trim())) {
        message.error('仍有成员条目未生成（可手填 YAML 内容后重试，或删除该成员）');
        return;
      }
    }
    const card = blankCard(cardName.value.trim());
    const d = card.data as Record<string, unknown>;
    for (const [k, v] of Object.entries(outputs.value)) {
      if (v.trim()) d[k] = v;
    }
    d.tags = [...new Set([...draftTags.value])];
    // 成员清单 → character_book.entries（多人卡心智：成员设定全部进世界书）
    if (named.length) {
      const book = (d.character_book ?? { entries: [] }) as { entries?: unknown[] };
      const existing = Array.isArray(book.entries) ? book.entries : [];
      let nextId = existing.reduce<number>((mx, e) => Math.max(mx, Number((e as { id?: number }).id ?? -1)), -1) + 1;
      book.entries = [...existing, ...named.map((m) => memberToEntry(m, nextId++))];
      d.character_book = book;
    }
    const row = await cardService.createCard(cardName.value.trim(), card);
    await ws.refreshCards(true);
    message.success('整卡已生成并入库，去编辑器检查');
    router.push(`/editor/${row.id}`);
  } finally {
    saving.value = false;
  }
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

        <!-- 角色成员清单（多人卡）：条目写入世界书，主角常驻、配角触发词 -->
        <div class="wiz-step">
          <div class="wiz-step-head">
            <b>角色成员（多人卡可选）</b>
            <span class="wiz-step-hint">成员设定生成到世界书条目：主角常驻注入，配角按称呼触发；单人卡可留空</span>
            <NSpace :size="6" style="margin-left: auto">
              <NButton size="tiny" secondary :loading="busy === 'members'" @click="genMemberEntries()">
                <template #icon><NIcon><SparklesOutline /></NIcon></template>
                生成空缺条目
              </NButton>
              <NButton size="tiny" quaternary @click="addMember">+ 添加成员</NButton>
            </NSpace>
          </div>
          <template v-if="members.length">
            <div v-for="(m, i) in members" :key="i" class="wiz-member">
              <NSpace :size="8" align="center" wrap>
                <NInput v-model:value="m.name" size="small" placeholder="成员名称" style="width: 140px" />
                <NRadioGroup v-model:value="m.role" size="small">
                  <NRadioButton value="lead">主角（常驻）</NRadioButton>
                  <NRadioButton value="support">配角（触发）</NRadioButton>
                </NRadioGroup>
                <NInput v-model:value="m.aliases" size="small" placeholder="触发称呼，逗号分隔（如：小婉, 婉儿）" style="flex: 1; min-width: 200px" />
                <NButton size="tiny" secondary :loading="busy === `member:${i}`" @click="genMemberEntries([m], `member:${i}`)">生成此条</NButton>
                <NButton size="tiny" quaternary type="error" @click="removeMember(i)">移除</NButton>
              </NSpace>
              <NInput v-model:value="m.content" type="textarea" :rows="4"
                placeholder="条目内容（YAML：name/性格/说话风格/与 {{user}} 的关系…）；可手填，或点「生成此条」"
                style="margin-top: 8px" />
            </div>
          </template>
          <NText v-else depth="3" style="font-size: 12px">尚未添加成员。多人卡（如事件导向模板）建议为每个 NPC 建一条</NText>
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
          <NButton type="primary" size="small" :loading="saving" :disabled="!canFinish" @click="finish">
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
.wiz-member { border: 1px dashed var(--tcs-border, rgba(255,255,255,.1)); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
</style>
