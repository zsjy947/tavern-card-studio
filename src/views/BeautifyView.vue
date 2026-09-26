<script setup lang="ts">
/**
 * 美化工作台：两种模式。
 * - 模板模式：选卡 → 选状态栏模板 → 变量工作台（增删改 key/label/值）→ 实时预览 → 三件套一键插入
 * - AI 生成模式（迭代五 E）：需求描述 → AI 设计变量路径清单（评审）→ AI 生成 HTML（自动续写）→ 预览 → 应用/沉淀为模板
 *   MVU 模式反向补全 MVU 套装；纯文本模式落「渲染正则 + 隐藏正则 + 输出指令蓝灯条目」。
 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NSelect, NCard, NInput, NTag, useMessage, NIcon, NGrid, NGridItem, NAlert, NText,
  NRadioButton, NRadioGroup, NSpin, NPopconfirm, NEmpty,
} from 'naive-ui';
import { ColorWandOutline, ImageOutline, AddOutline, TrashOutline, SparklesOutline, RefreshOutline, SaveOutline } from '@vicons/ionicons5';
import { listTemplates, saveTemplate } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';
import type { CardRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import * as aiService from '@/services/aiService';
import { insertStatusbar, renderStatusbarHtml, normalizeImageLink, renameStatusbarVariable, buildMvuStatusbarArtifacts, buildTextStatusbarArtifacts, applyAiStatusbarArtifacts } from '@/services/beautifyService';
import HtmlPreview from '@/components/HtmlPreview.vue';
import CodeEditor from '@/components/CodeEditor.vue';
import { useWorkspace } from '@/stores/workspace';
import { buildCardContext } from '@/core/llm/context';
import { STATUSBAR_SYSTEM_PROMPT, buildContinuePrompt, buildHtmlPrompt, buildTextPrompt, buildVarListPrompt, cleanHtmlComments, extractHtml, findMissingTabs, isHtmlComplete, mergeContinuation, type SbLayout, type SbStyle, type StatusbarVarPath } from '@/core/llm/htmlgen';
import { detectExistingMvu, applyMvuToCard, MVU_DEFAULT_CONFIG } from '@/core/mvu/suite';
import { buildZodCode } from '@/core/mvu/model';
import type { AnyCard } from '@/core/card';

const message = useMessage();
const ws = useWorkspace();

const mode = ref<'template' | 'ai'>('template');

const templates = ref<TemplateRow[]>([]);
const chosenTplId = ref<string | null>(null);
const cards = ref<CardRow[]>([]);
const chosenCardId = ref<string | null>(null);
const varValues = ref<Record<string, string>>({});
const customCss = ref('');
const inserted = ref(false);

onMounted(async () => {
  await ws.refreshCards(true);
  cards.value = ws.cards.filter((c) => !c.deletedAt);
  templates.value = await listTemplates('statusbar');
  if (templates.value[0]) chooseTpl(templates.value[0].id);
});

/** 工作副本：变量工作台的增删改都发生在 draft 上，内置模板不受影响 */
const draft = ref<StatusbarPayload | null>(null);

const chosenCard = computed(() => cards.value.find((c) => c.id === chosenCardId.value) ?? null);

/** payload 形状归一：自建/导入模板可能缺 variables/previewMock/worldinfoEntry */
function normalizeStatusbar(p: StatusbarPayload): StatusbarPayload {
  return {
    ...p,
    variables: Array.isArray(p.variables) ? p.variables : [],
    previewMock: p.previewMock && typeof p.previewMock === 'object' ? p.previewMock : {},
    worldinfoEntry: p.worldinfoEntry && typeof p.worldinfoEntry === 'object'
      ? p.worldinfoEntry
      : { comment: '状态栏规则（蓝灯）', keys: ['状态栏'], content: '' },
  };
}

function chooseTpl(id: string) {
  chosenTplId.value = id;
  const p = templates.value.find((t) => t.id === id)?.payload as StatusbarPayload | undefined;
  // payload 是深层响应式代理，structuredClone 会抛 DataCloneError，用 JSON 深拷贝
  draft.value = p ? normalizeStatusbar(JSON.parse(JSON.stringify(p)) as StatusbarPayload) : null;
  varValues.value = {};
  if (p) for (const v of draft.value!.variables) varValues.value[v.key] = draft.value!.previewMock[v.key] ?? v.initial;
  customCss.value = draft.value?.css ?? '';
}

const previewVars = computed(() => {
  const vars = { ...varValues.value };
  if (chosenCard.value && vars.char_name) vars.char_name = chosenCard.value.name;
  return vars;
});

const previewHtml = computed(() => (draft.value ? renderStatusbarHtml(draft.value, previewVars.value, chosenCard.value?.name ?? '{{char}}', ws.userName) : ''));

const imageLinkInput = computed(() => {
  const p = draft.value;
  const urlVar = p?.variables.find((v) => v.key.includes('url'));
  return urlVar ? varValues.value[urlVar.key] ?? '' : '';
});
const imageLinkWarn = computed(() => {
  if (!imageLinkInput.value) return '';
  const r = normalizeImageLink(imageLinkInput.value);
  return r.warning ?? (r.kind === 'file' ? '本地路径已转为 file:// 外链（他人使用时需保证路径存在或换在线图床）' : '');
});

/* ---------------- 变量工作台（模板模式） ---------------- */

const VAR_KEY_RE = /^[a-z_][a-z0-9_]*$/;

/** 改名：重写 html/css/js/世界书说明/previewMock 的全部引用，并迁移已填值 */
function onVarKeyChange(index: number, newKey: string) {
  const p = draft.value;
  if (!p) return;
  const oldKey = p.variables[index]?.key;
  if (!oldKey || newKey === oldKey) return;
  if (!VAR_KEY_RE.test(newKey)) {
    message.error('变量 key 需为小写字母/下划线开头，仅含小写字母、数字、下划线');
    return;
  }
  try {
    draft.value = renameStatusbarVariable(p, oldKey, newKey);
    if (Object.prototype.hasOwnProperty.call(varValues.value, oldKey)) {
      const val = varValues.value[oldKey]!;
      delete varValues.value[oldKey];
      varValues.value[newKey] = val;
    }
  } catch (e) {
    message.error((e as Error).message);
  }
}

function onVarLabelChange(index: number, label: string) {
  const v = draft.value?.variables[index];
  if (v) v.label = label;
}

function addVar() {
  const p = draft.value;
  if (!p) return;
  let key = 'new_var';
  let i = 1;
  while (p.variables.some((v) => v.key === key)) key = `new_var_${++i}`;
  p.variables.push({ key, label: '新变量', initial: '' });
  varValues.value[key] = '';
}

function removeVar(key: string) {
  const p = draft.value;
  if (!p) return;
  p.variables = p.variables.filter((v) => v.key !== key);
  delete varValues.value[key];
  delete p.previewMock[key];
}

/** 分组小标题：group 与上一行不同时显示 */
function groupHeaderOf(index: number): string | null {
  const vars = draft.value?.variables;
  if (!vars) return null;
  const g = vars[index]?.group ?? null;
  if (!g) return null;
  const prev = index > 0 ? vars[index - 1]?.group ?? null : null;
  return g !== prev ? g : null;
}

async function insert() {
  if (!chosenCard.value || !draft.value) {
    message.error('先选择卡片与模板');
    return;
  }
  const row = await cardService.getCard(chosenCard.value.id);
  if (!row) return;
  // 第 3 步编辑的自定义 CSS 是用户确认过的最终样式，插入前合并进 payload
  draft.value.css = customCss.value;
  let next: AnyCard;
  try {
    next = insertStatusbar(row.card, draft.value, {
      variables: previewVars.value,
      charName: chosenCard.value.name,
      userName: ws.userName,
    }).card;
  } catch (e) {
    message.error(`插入失败：${(e as Error).message}`);
    return;
  }
  await cardService.saveCard(row.id, next, { note: `美化：插入状态栏 ${draft.value.tag}`, keepCover: true });
  await ws.refreshCards(true);
  inserted.value = true;
  message.success('三件套已插入并保存；导出 PNG 后在 SillyTavern 中验证渲染');
}

/* ================================================================ */
/* AI 生成模式（迭代五 E）                                           */
/* ================================================================ */

const aiStep = ref(0);
const aiMode = ref<'mvu' | 'text'>('mvu');
const aiStyle = ref<SbStyle>('dark');
const aiLayout = ref<SbLayout>('tabs');
const aiExtra = ref('');
const SB_STYLE_OPTIONS = [
  { label: '深色科技', value: 'dark' },
  { label: '浅色简约', value: 'light' },
  { label: '柔和粉彩', value: 'pastel' },
  { label: '游戏面板', value: 'game' },
];
const SB_LAYOUT_OPTIONS = [
  { label: '多页签（tab 切换）', value: 'tabs' },
  { label: '单面板（一屏罗列）', value: 'single' },
  { label: '紧凑条（横向摘要）', value: 'compact' },
  { label: '卡片网格', value: 'cards' },
];

const aiVarList = ref<StatusbarVarPath[]>([]);
const aiHtml = ref('');
const aiGenerating = ref(false);
const aiNote = ref('');

const cardHasMvu = computed(() => (chosenCard.value ? detectExistingMvu(chosenCard.value.card as never) : false));

const aiContext = computed(() => {
  const card = chosenCard.value;
  if (!card) return '';
  return buildCardContext(card.card as never, { matchText: aiExtra.value });
});

/** 第一步 → 第二步：AI 设计变量路径清单 */
async function genVarList() {
  if (!chosenCard.value) {
    message.error('先选择卡片');
    return;
  }
  aiGenerating.value = true;
  aiNote.value = '';
  try {
    const raw = await aiService.runFieldAiJson<unknown>({
      feature: 'mvu:varlist',
      systemPrompt: buildVarListPrompt(aiContext.value, aiExtra.value),
      userPrompt: '请按三步思考法设计变量路径，只输出 JSON 数组。',
      jsonSchemaHint: '[{"group":"主角","field":"名称","type":"string","default":""}]',
    });
    const arr = Array.isArray(raw) ? raw : [];
    aiVarList.value = arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        group: String(x.group ?? '其他'),
        field: String(x.field ?? ''),
        type: x.type === 'number' ? 'number' as const : 'string' as const,
        default: String(x.default ?? ''),
      }))
      .filter((x) => x.field);
    if (!aiVarList.value.length) {
      message.error('AI 未返回有效变量，请补充需求后重试');
      return;
    }
    aiStep.value = 1;
  } catch (e) {
    message.error(`变量设计失败：${(e as Error).message}`);
  } finally {
    aiGenerating.value = false;
  }
}

/** 第二步 → 第三步：按变量清单生成 HTML（截断自动续写，最多 3 次） */
async function genHtml() {
  if (!chosenCard.value) return;
  aiGenerating.value = true;
  aiNote.value = '';
  try {
    const isText = aiMode.value === 'text';
    const prompt = isText
      ? buildTextPrompt(aiContext.value, aiStyle.value, aiLayout.value, aiExtra.value)
      : buildHtmlPrompt(aiContext.value, aiVarList.value, aiStyle.value, aiLayout.value, aiExtra.value);
    const result = await aiService.runFieldAi({
      feature: 'beautify:statusbar-gen',
      systemPrompt: STATUSBAR_SYSTEM_PROMPT,
      userPrompt: prompt,
      temperature: 0.8,
    });
    let html = extractHtml(result);

    // 截断自动续写：尾部 400 字符上下文，最多 3 次
    const MAX_CONTINUE = 3;
    for (let i = 0; i < MAX_CONTINUE; i++) {
      if (isHtmlComplete(html)) break;
      const missingTabs = findMissingTabs(html);
      aiNote.value = missingTabs.length ? `缺少 tab 内容：${missingTabs.join('、')}，自动续写中（${i + 1}/${MAX_CONTINUE}）` : `缺少结尾标签，自动续写中（${i + 1}/${MAX_CONTINUE}）`;
      const cont = buildContinuePrompt(html, missingTabs);
      const contResult = await aiService.runFieldAi({
        feature: 'beautify:statusbar-gen',
        systemPrompt: cont.system,
        userPrompt: cont.user,
        temperature: 0.3,
      });
      const continued = extractHtml(contResult);
      if (!continued) break;
      html = mergeContinuation(html, continued, missingTabs);
    }

    aiHtml.value = cleanHtmlComments(html);
    if (!isHtmlComplete(aiHtml.value)) aiNote.value = 'HTML 仍未完整，建议简化需求后重新生成';
    else aiNote.value = '';
    aiStep.value = 2;
  } catch (e) {
    message.error(`HTML 生成失败：${(e as Error).message}`);
  } finally {
    aiGenerating.value = false;
  }
}

function addAiVar() {
  aiVarList.value.push({ group: '主角', field: '新变量', type: 'string', default: '' });
}

function removeAiVar(i: number) {
  aiVarList.value.splice(i, 1);
}

/** 应用：MVU 模式反向补全 MVU 套装 + 状态栏渲染正则；纯文本模式落三件 */
async function applyAi() {
  if (!chosenCard.value || !aiHtml.value) return;
  const row = await cardService.getCard(chosenCard.value.id);
  if (!row) return;
  let next: AnyCard = JSON.parse(JSON.stringify(row.card)) as AnyCard;

  if (aiMode.value === 'mvu') {
    // 反向创建/补全 MVU：卡内没有套装时从变量清单构建；已有则只补状态栏渲染正则
    if (!detectExistingMvu(next)) {
      const groups = varListToMvuGroups(aiVarList.value);
      next = applyMvuToCard(next, groups as never, buildZodCode(groups as never), { ...MVU_DEFAULT_CONFIG });
      message.info('已从变量清单反向创建 MVU 套装');
    }
    next = applyAiStatusbarArtifacts(next, buildMvuStatusbarArtifacts(aiHtml.value));
  } else {
    next = applyAiStatusbarArtifacts(next, buildTextStatusbarArtifacts(aiHtml.value));
  }

  await cardService.saveCard(row.id, next, { note: `美化：AI 生成状态栏（${aiMode.value === 'mvu' ? 'MVU' : '纯文本'}）`, keepCover: true, forceSnapshot: true });
  await ws.refreshCards(true);
  message.success('AI 状态栏已应用并保存');
}

/** 沉淀为模板：生成结果入模板中心（statusbar kind），可复用到其他卡 */
async function saveAsTemplate() {
  if (!aiHtml.value) return;
  const name = `AI 状态栏 · ${SB_STYLE_OPTIONS.find((s) => s.value === aiStyle.value)?.label ?? ''}（${new Date().toLocaleDateString()}）`;
  const payload: StatusbarPayload = {
    tag: '<AiStatusbar/>',
    html: aiHtml.value,
    css: '',
    js: '',
    variables: aiVarList.value.map((v) => ({ key: `${v.group}.${v.field}`, label: v.field, initial: v.default })),
    worldinfoEntry: { comment: '状态栏规则（蓝灯）', keys: ['状态栏'], content: '' },
    previewMock: Object.fromEntries(aiVarList.value.map((v) => [`${v.group}.${v.field}`, v.default])),
  };
  await saveTemplate({ kind: 'statusbar', name, description: `AI 生成（${aiMode.value === 'mvu' ? 'MVU 模式' : '纯文本模式'}），点选定向改请在美化工作台打开`, payload });
  message.success('已沉淀为状态栏模板，可在模板中心查看');
}

function varListToMvuGroups(list: StatusbarVarPath[]) {
  const map = new Map<string, { name: string; type: 'number' | 'string'; defaultValue: string; min: null; max: null; clamp: boolean; enumValues: string; recordFields: string; description: string }[]>();
  for (const v of list) {
    const g = v.group || '其他';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push({ name: v.field, type: v.type, defaultValue: v.default, min: null, max: null, clamp: false, enumValues: '', recordFields: '', description: '' });
  }
  return [...map.entries()].map(([name, fields]) => ({ name, fields }));
}

watch(mode, () => {
  aiStep.value = 0;
  aiNote.value = '';
});
</script>

<template>
  <div style="max-width: 1180px">
    <NAlert type="info" :bordered="false" style="margin-bottom: 14px">
      模板模式：选模板 → 调变量 → 预览 → 一键插入三件套。AI 生成模式：描述需求 → AI 设计变量清单 → AI 生成 HTML（截断自动续写）→ 应用。
    </NAlert>

    <NSpace align="center" :size="10" style="margin-bottom: 12px">
      <NRadioGroup v-model:value="mode" size="small">
        <NRadioButton value="template">模板模式</NRadioButton>
        <NRadioButton value="ai">AI 生成</NRadioButton>
      </NRadioGroup>
      <NSelect v-model:value="chosenCardId" :options="cards.map((c) => ({ label: c.name, value: c.id }))" filterable placeholder="选择要美化的卡" style="width: 240px" />
    </NSpace>

    <!-- ==================== 模板模式（原有流程） ==================== -->
    <NGrid v-if="mode === 'template'" :cols="5" :x-gap="14">
      <NGridItem :span="2">
        <NSpace vertical :size="12">
          <NCard size="small" title="1 · 选择模板">
            <div class="beautify-tpl-grid">
              <div
                v-for="t in templates" :key="t.id" class="beautify-tpl"
                :class="{ 'beautify-tpl-active': chosenTplId === t.id }" @click="chooseTpl(t.id)"
              >
                <b>{{ t.name }}</b>
                <span class="beautify-tpl-desc">{{ t.description }}</span>
              </div>
            </div>
          </NCard>

          <NCard size="small" title="2 · 变量工作台">
            <NSpace v-if="draft" vertical :size="6">
              <template v-for="(v, i) in draft.variables" :key="v.key">
                <div v-if="groupHeaderOf(i)" class="var-group-head">{{ groupHeaderOf(i) }}</div>
                <div class="var-row">
                  <input
                    class="var-key" :value="v.key" :disabled="v.key === 'radar_points'"
                    placeholder="key" spellcheck="false"
                    @change="onVarKeyChange(i, ($event.target as HTMLInputElement).value.trim())"
                    @keyup.enter="($event.target as HTMLInputElement).blur()"
                  >
                  <NInput size="small" :value="v.label" placeholder="显示名" class="var-label"
                    @update:value="(val: string) => onVarLabelChange(i, val)" />
                  <NInput v-if="v.key.includes('url')" v-model:value="varValues[v.key]!" size="small" style="flex: 1; min-width: 140px" placeholder="本地文件夹路径或在线图片链接">
                    <template #prefix><NIcon><ImageOutline /></NIcon></template>
                  </NInput>
                  <NInput v-else-if="v.key === 'radar_points'" :value="varValues[v.key]" size="small" disabled style="flex: 1; min-width: 140px" placeholder="由六维数值自动计算" />
                  <NInput v-else-if="v.key === 'char_name' && chosenCardId" :value="varValues[v.key]" size="small" disabled style="flex: 1; min-width: 120px" placeholder="跟随所选卡名" />
                  <NInput v-else v-model:value="varValues[v.key]!" size="small" style="flex: 1; min-width: 120px" :placeholder="v.initial" />
                  <NButton size="tiny" quaternary type="error" @click="removeVar(v.key)">
                    <template #icon><NIcon><TrashOutline /></NIcon></template>
                  </NButton>
                </div>
              </template>
              <NButton size="small" dashed @click="addVar">
                <template #icon><NIcon><AddOutline /></NIcon></template>
                添加变量
              </NButton>
              <NAlert v-if="imageLinkWarn" type="warning" :bordered="false" style="font-size: 12px">{{ imageLinkWarn }}</NAlert>
              <NTag size="small" :bordered="false" type="info">图片采用外链（本地路径自动转 file://），不膨胀卡体积</NTag>
            </NSpace>
            <NEmpty v-else description="先选择一个模板" />
          </NCard>

          <NCard size="small" title="3 · 自定义 CSS（可选）">
            <CodeEditor v-model="customCss" language="text" height="160px" />
            <template #action>
              <NButton type="primary" size="small" :disabled="!chosenCardId || !draft" @click="insert">
                <template #icon><NIcon><ColorWandOutline /></NIcon></template>一键插入三件套
              </NButton>
            </template>
          </NCard>
        </NSpace>
      </NGridItem>

      <NGridItem :span="3">
        <NSpace vertical :size="12">
          <NCard size="small" title="实时预览（iframe 沙箱，复刻酒馆消息容器）">
            <HtmlPreview :html="previewHtml" :css="customCss" :js="draft?.js" height="360px" />
            <template #action>
              <NSpace :size="8" align="center">
                <NTag v-if="draft" size="tiny" :bordered="false">占位符：<code>{{ draft.tag }}</code></NTag>
                <NText depth="3" style="font-size: 12px">JS 在 TavernHelper 环境下会用运行时变量刷新数值</NText>
              </NSpace>
            </template>
          </NCard>
          <NCard v-if="draft" size="small" title="生成的正则脚本（插入后写入卡内）">
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 6px">
              findRegex: <code>{{ draft.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '\\') }}</code> → 替换为右侧渲染后的 HTML（此处示意前 500 字）
            </NText>
            <pre class="beautify-html-preview">{{ previewHtml.slice(0, 500) }}…</pre>
          </NCard>
        </NSpace>
      </NGridItem>
    </NGrid>

    <!-- ==================== AI 生成模式 ==================== -->
    <template v-else>
      <NSpin :show="aiGenerating">
        <!-- 第一步：需求 -->
        <NCard v-if="aiStep === 0" size="small" title="第 1 步 · 需求描述">
          <NSpace vertical :size="10">
            <NSpace align="center">
              <span class="ai-label">数据模式</span>
              <NRadioGroup v-model:value="aiMode" size="small">
                <NRadioButton value="mvu">MVU 模式（推荐，配合「变量」Tab）</NRadioButton>
                <NRadioButton value="text">纯文本模式（无 MVU）</NRadioButton>
              </NRadioGroup>
              <NTag v-if="cardHasMvu" size="tiny" type="success" :bordered="false">卡内已有 MVU 套装</NTag>
            </NSpace>
            <NSpace align="center">
              <span class="ai-label">视觉风格</span>
              <NSelect v-model:value="aiStyle" :options="SB_STYLE_OPTIONS" size="small" style="width: 160px" />
              <span class="ai-label">布局</span>
              <NSelect v-model:value="aiLayout" :options="SB_LAYOUT_OPTIONS" size="small" style="width: 200px" />
            </NSpace>
            <NInput v-model:value="aiExtra" type="textarea" :rows="3" placeholder="额外需求（如：修仙卡，重点显示境界/灵石/背包；顶部要头像位）——AI 会据此盘点动态数据，不套 RPG 模板" />
            <NButton type="primary" :disabled="!chosenCardId" :loading="aiGenerating" @click="genVarList">
              <template #icon><NIcon><SparklesOutline /></NIcon></template>
              AI 设计变量路径清单
            </NButton>
          </NSpace>
        </NCard>

        <!-- 第二步：变量清单评审 -->
        <NCard v-else-if="aiStep === 1" size="small" title="第 2 步 · 变量路径清单（可直接修改）">
          <NSpace vertical :size="10">
            <div class="ai-var-table">
              <div v-for="(v, i) in aiVarList" :key="i" class="var-row">
                <NInput v-model:value="v.group" size="small" placeholder="分组" style="width: 120px; flex-shrink: 0" />
                <span style="opacity: .5">.</span>
                <NInput v-model:value="v.field" size="small" placeholder="字段（可嵌套 a.b）" style="width: 200px; flex-shrink: 0" />
                <NSelect v-model:value="v.type" size="small" :options="[{ label: '文本', value: 'string' }, { label: '数字', value: 'number' }]" style="width: 90px; flex-shrink: 0" />
                <NInput v-model:value="v.default" size="small" placeholder="默认值" style="flex: 1" />
                <NButton size="tiny" quaternary type="error" @click="removeAiVar(i)"><template #icon><NIcon><TrashOutline /></NIcon></template></NButton>
              </div>
              <NButton size="small" dashed @click="addAiVar"><template #icon><NIcon><AddOutline /></NIcon></template>添加变量</NButton>
            </div>
            <NSpace>
              <NButton @click="aiStep = 0">返回需求</NButton>
              <NButton type="primary" :loading="aiGenerating" @click="genHtml">
                <template #icon><NIcon><SparklesOutline /></NIcon></template>
                生成状态栏 HTML（{{ aiMode === 'mvu' ? 'MVU' : '纯文本' }}）
              </NButton>
            </NSpace>
          </NSpace>
        </NCard>

        <!-- 第三步：HTML 预览 -->
        <NCard v-else size="small" title="第 3 步 · 预览与应用">
          <NSpace vertical :size="10">
            <NAlert v-if="aiNote" type="warning" :bordered="false" style="font-size: 12px">{{ aiNote }}</NAlert>
            <HtmlPreview :html="aiHtml" allow-scripts height="420px" />
            <NSpace>
              <NButton @click="aiStep = 1">返回清单</NButton>
              <NButton :loading="aiGenerating" @click="genHtml"><template #icon><NIcon><RefreshOutline /></NIcon></template>重新生成</NButton>
              <NButton type="primary" :disabled="!aiHtml" @click="applyAi">
                <template #icon><NIcon><ColorWandOutline /></NIcon></template>
                应用到卡（{{ aiMode === 'mvu' ? '渲染正则 + 占位符' : '2 正则 + 指令条目' }}）
              </NButton>
              <NPopconfirm @positive-click="saveAsTemplate">
                <template #trigger><NButton secondary :disabled="!aiHtml"><template #icon><NIcon><SaveOutline /></NIcon></template>沉淀为模板</NButton></template>
                保存到模板中心（statusbar 类型）？
              </NPopconfirm>
            </NSpace>
            <NText depth="3" style="font-size: 12px">
              {{ aiMode === 'mvu'
                ? 'MVU 模式：HTML 作为 <StatusPlaceHolderImpl/> 的渲染正则写入；卡内无 MVU 套装时会从变量清单反向创建。'
                : '纯文本模式：AI 每次回复末尾输出 <StatusData> 块，渲染正则解析显示；配套对 AI 隐藏（minDepth=6）与蓝灯输出指令条目。' }}
            </NText>
          </NSpace>
        </NCard>
      </NSpin>
    </template>
  </div>
</template>

<style scoped>
.beautify-tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.beautify-tpl {
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--tcs-border, rgba(255,255,255,.1)); background: var(--tcs-fill, rgba(255,255,255,.03));
  display: flex; flex-direction: column; gap: 4px; font-size: 13px;
}
.beautify-tpl:hover { border-color: var(--tcs-accent-border, rgba(139,92,246,.5)); }
.beautify-tpl-active { border-color: var(--tcs-accent, #8b5cf6); background: var(--tcs-accent-soft, rgba(139,92,246,.1)); }
.beautify-tpl-desc { font-size: 11px; opacity: .65; line-height: 1.4; }
.beautify-html-preview {
  background: var(--tcs-editor-bg, rgba(0,0,0,.35)); border-radius: 8px; padding: 10px;
  font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow: auto;
}
.var-row { display: flex; gap: 6px; align-items: center; }
.var-key {
  width: 130px; flex-shrink: 0; font-family: monospace; font-size: 12px;
  border: 1px solid var(--tcs-border, rgba(255,255,255,.15)); border-radius: 4px;
  background: var(--tcs-input, transparent); color: inherit;
  padding: 0 8px; height: 28px; outline: none;
}
.var-key:focus { border-color: var(--tcs-accent, #8b5cf6); }
.var-key:disabled { opacity: .55; }
.var-label { width: 110px; flex-shrink: 0; }
.var-group-head {
  font-size: 11px; font-weight: 700; opacity: .7; letter-spacing: 1px;
  border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.1)); padding-top: 8px; margin-top: 4px;
}
.ai-label { font-size: 12px; font-weight: 600; opacity: .8; }
.ai-var-table { display: flex; flex-direction: column; gap: 6px; }
</style>
