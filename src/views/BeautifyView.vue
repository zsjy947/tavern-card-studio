<script setup lang="ts">
/** 美化工作台：选卡 → 选状态栏模板 → 变量工作台（增删改 key/label/值）→ 实时预览 → 三件套一键插入 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NSelect, NCard, NInput, NTag, useMessage, NIcon, NGrid, NGridItem, NAlert, NText,
} from 'naive-ui';
import { ColorWandOutline, ImageOutline, AddOutline, TrashOutline } from '@vicons/ionicons5';
import { listTemplates } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';
import type { CardRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import { insertStatusbar, renderStatusbarHtml, normalizeImageLink, renameStatusbarVariable } from '@/services/beautifyService';
import HtmlPreview from '@/components/HtmlPreview.vue';
import CodeEditor from '@/components/CodeEditor.vue';
import { useWorkspace } from '@/stores/workspace';

const message = useMessage();
const ws = useWorkspace();

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

function chooseTpl(id: string) {
  chosenTplId.value = id;
  const p = templates.value.find((t) => t.id === id)?.payload as StatusbarPayload | undefined;
  // payload 是深层响应式代理，structuredClone 会抛 DataCloneError，用 JSON 深拷贝
  draft.value = p ? (JSON.parse(JSON.stringify(p)) as StatusbarPayload) : null;
  varValues.value = {};
  if (p) for (const v of p.variables) varValues.value[v.key] = p.previewMock[v.key] ?? v.initial;
  customCss.value = p?.css ?? '';
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

/* ---------------- 变量工作台 ---------------- */

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
  const { card: next, inserted: ins } = insertStatusbar(row.card, draft.value, {
    variables: previewVars.value,
    charName: chosenCard.value.name,
    userName: ws.userName,
  });
  await cardService.saveCard(row.id, next, { note: `美化：插入状态栏 ${draft.value.tag}`, keepCover: true });
  await ws.refreshCards(true);
  inserted.value = true;
  message.success(`三件套已插入并保存${ins.tag ? '' : '（tag 已存在，跳过重复插入）'}；导出 PNG 后在 SillyTavern 中验证渲染`);
}
</script>

<template>
  <div style="max-width: 1180px">
    <NAlert type="info" :bordered="false" style="margin-bottom: 14px">
      选中卡片 → 选状态栏模板 → 调变量（可改 key/显示名、增删行，改名会同步重写 HTML/JS/世界书说明）→ 预览满意后「一键插入」。
      插入 = 开场白加占位符 + 注册正则渲染脚本 + 世界书加规则条目（三件套），保存后自动存版本快照，可随时回滚。
    </NAlert>

    <NGrid :cols="5" :x-gap="14">
      <NGridItem :span="2">
        <NSpace vertical :size="12">
          <NCard size="small" title="1 · 选择卡片与模板">
            <NSpace vertical :size="8">
              <NSelect v-model:value="chosenCardId" :options="cards.map((c) => ({ label: c.name, value: c.id }))" filterable placeholder="选择要美化的卡" />
              <div class="beautify-tpl-grid">
                <div
                  v-for="t in templates" :key="t.id" class="beautify-tpl"
                  :class="{ 'beautify-tpl-active': chosenTplId === t.id }" @click="chooseTpl(t.id)"
                >
                  <b>{{ t.name }}</b>
                  <span class="beautify-tpl-desc">{{ t.description }}</span>
                </div>
              </div>
            </NSpace>
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
</style>
