<script setup lang="ts">
/** 美化工作台：选卡 → 选状态栏模板 → 变量填值/外链图 → 实时预览 → 三件套一键插入 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NSelect, NCard, NInput, NTag, useMessage, NIcon, NGrid, NGridItem, NFormItem, NAlert, NText, NInputNumber,
} from 'naive-ui';
import { ColorWandOutline, ImageOutline, CheckmarkOutline } from '@vicons/ionicons5';
import { listTemplates } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';
import type { CardRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import { insertStatusbar, renderStatusbarHtml, normalizeImageLink } from '@/services/beautifyService';
import { renderTemplate } from '@/core/template';
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

const tpl = computed<StatusbarPayload | null>(() => {
  const row = templates.value.find((t) => t.id === chosenTplId.value);
  return row ? (row.payload as StatusbarPayload) : null;
});

const chosenCard = computed(() => cards.value.find((c) => c.id === chosenCardId.value) ?? null);

function chooseTpl(id: string) {
  chosenTplId.value = id;
  const p = templates.value.find((t) => t.id === id)?.payload as StatusbarPayload | undefined;
  varValues.value = {};
  if (p) for (const v of p.variables) varValues.value[v.key] = p.previewMock[v.key] ?? v.initial;
  customCss.value = p?.css ?? '';
}

const previewVars = computed(() => {
  const vars = { ...varValues.value };
  if (chosenCard.value && vars.char_name) vars.char_name = chosenCard.value.name;
  return vars;
});

const previewHtml = computed(() => (tpl.value ? renderStatusbarHtml(tpl.value, previewVars.value, chosenCard.value?.name ?? '{{char}}', ws.userName) : ''));

const imageLinkInput = computed(() => (tpl.value?.variables.some((v) => v.key.includes('url')) ? varValues.value[tpl.value.variables.find((v) => v.key.includes('url'))!.key] ?? '' : ''));
const imageLinkWarn = computed(() => {
  if (!imageLinkInput.value) return '';
  const r = normalizeImageLink(imageLinkInput.value);
  return r.warning ?? (r.kind === 'file' ? '本地路径已转为 file:// 外链（他人使用时需保证路径存在或换在线图床）' : '');
});

async function insert() {
  if (!chosenCard.value || !tpl.value) {
    message.error('先选择卡片与模板');
    return;
  }
  const row = await cardService.getCard(chosenCard.value.id);
  if (!row) return;
  const { card: next, inserted: ins } = insertStatusbar(row.card, tpl.value, {
    variables: previewVars.value,
    charName: chosenCard.value.name,
    userName: ws.userName,
  });
  await cardService.saveCard(row.id, next, { note: `美化：插入状态栏 ${tpl.value.tag}`, keepCover: true });
  await ws.refreshCards(true);
  inserted.value = true;
  message.success(`三件套已插入并保存${ins.tag ? '' : '（tag 已存在，跳过重复插入）'}；导出 PNG 后在 SillyTavern 中验证渲染`);
}
</script>

<template>
  <div style="max-width: 1180px">
    <NAlert type="info" :bordered="false" style="margin-bottom: 14px">
      选中卡片 → 选状态栏模板 → 调变量（图片用外链）→ 预览满意后「一键插入」。
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

          <NCard size="small" title="2 · 变量设置">
            <NSpace v-if="tpl" vertical :size="8">
              <NFormItem v-for="v in tpl.variables" :key="v.key" :label="v.label" label-placement="left" size="small" :show-feedback="false" style="margin-bottom: 6px">
                <NInput v-if="v.key.includes('url')" v-model:value="varValues[v.key]!" placeholder="本地文件夹路径或在线图片链接">
                  <template #prefix><NIcon><ImageOutline /></NIcon></template>
                </NInput>
                <NInput v-else-if="v.key === 'radar_points'" :value="varValues[v.key]!" disabled placeholder="由六维数值自动计算" />
                <NInput v-else v-model:value="varValues[v.key]!" :placeholder="v.initial" />
              </NFormItem>
              <NAlert v-if="imageLinkWarn" type="warning" :bordered="false" style="font-size: 12px">{{ imageLinkWarn }}</NAlert>
              <NTag size="small" :bordered="false" type="info">图片采用外链（本地路径自动转 file://），不膨胀卡体积</NTag>
            </NSpace>
          </NCard>

          <NCard size="small" title="3 · 自定义 CSS（可选）">
            <CodeEditor v-model="customCss" language="text" height="160px" />
            <template #action>
              <NButton type="primary" size="small" :disabled="!chosenCardId || !tpl" @click="insert">
                <template #icon><NIcon><ColorWandOutline /></NIcon></template>一键插入三件套
              </NButton>
            </template>
          </NCard>
        </NSpace>
      </NGridItem>

      <NGridItem :span="3">
        <NSpace vertical :size="12">
          <NCard size="small" title="实时预览（iframe 沙箱，复刻酒馆消息容器）">
            <HtmlPreview :html="previewHtml" :css="customCss" :js="tpl?.js" height="360px" />
            <template #action>
              <NSpace :size="8" align="center">
                <NTag size="tiny" :bordered="false">占位符：<code>{{ tpl?.tag }}</code></NTag>
                <NText depth="3" style="font-size: 12px">JS 在 TavernHelper 环境下会用运行时变量刷新数值</NText>
              </NSpace>
            </template>
          </NCard>
          <NCard v-if="tpl" size="small" title="生成的正则脚本（插入后写入卡内）">
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 6px">
              findRegex: <code>{{ tpl.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '\\') }}</code> → 替换为右侧渲染后的 HTML（此处示意前 500 字）
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
  border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03);
  display: flex; flex-direction: column; gap: 4px; font-size: 13px;
}
.beautify-tpl:hover { border-color: rgba(139,92,246,.5); }
.beautify-tpl-active { border-color: #8b5cf6; background: rgba(139,92,246,.1); }
.beautify-tpl-desc { font-size: 11px; opacity: .65; line-height: 1.4; }
.beautify-html-preview {
  background: rgba(0,0,0,.35); border-radius: 8px; padding: 10px;
  font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow: auto;
}
</style>
