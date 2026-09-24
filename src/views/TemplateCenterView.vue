<script setup lang="ts">
/** 模板中心：四类模板（card/statusbar/regex/prompt）管理 + 导入导出 + 沉淀当前卡为模板 */
import { computed, onMounted, ref } from 'vue';
import {
  NSpace, NButton, NTabs, NTabPane, NCard, NTag, useMessage, NIcon, NEmpty, NPopconfirm, NInput, NModal, NForm, NFormItem, NSelect, NRadioGroup, NRadioButton,
} from 'naive-ui';
import { AddOutline, TrashOutline, CopyOutline, DownloadOutline, CloudUploadOutline, LayersOutline } from '@vicons/ionicons5';
import { listTemplates, deleteTemplate, cloneTemplate, exportTemplate, importTemplate, saveTemplate } from '@/services/templateService';
import type { TemplateRow, TemplateKind } from '@/services/types';
import type { CardTemplatePayload } from '@/builtins/cardTemplates';
import type { PromptPayload } from '@/builtins/promptTemplates';
import type { StatusbarPayload } from '@/builtins/statusbarTemplates';
import CodeEditor from '@/components/CodeEditor.vue';
import { pickJsonFiles } from '@/utils/file';
import { downloadText } from '@/services/backupService';
import { useWorkspace } from '@/stores/workspace';
import * as cardService from '@/services/cardService';
import { pickPngFiles } from '@/utils/file';

const message = useMessage();
const ws = useWorkspace();

const kind = ref<TemplateKind>('card');
const templates = ref<TemplateRow[]>([]);
const showNew = ref(false);
const newForm = ref<{ kind: TemplateKind; name: string; json: string }>({ kind: 'card', name: '', json: '{}' });

onMounted(refresh);

async function refresh() {
  templates.value = await listTemplates();
}

const byKind = computed(() => templates.value.filter((t) => t.kind === kind.value));

function preview(t: TemplateRow): string {
  // payload 来自用户新建/导入，形状不可信：一律可选链，畸形数据只影响预览文案不能崩页面
  const p = (t.payload ?? {}) as Record<string, unknown>;
  try {
    switch (t.kind) {
      case 'card': {
        const fields = (p.fields as { label?: string }[] | undefined) ?? [];
        return fields.length ? fields.map((f) => f.label ?? '?').join(' · ') : '（模板未定义字段）';
      }
      case 'statusbar': {
        const vars = (p.variables as unknown[] | undefined) ?? [];
        return `占位符 ${String(p.tag ?? '?')}，${vars.length} 个变量`;
      }
      case 'regex':
        return String((p.script as { findRegex?: string } | undefined)?.findRegex ?? '（未定义正则）');
      case 'prompt':
        return `target: ${String(p.target ?? '?')}`;
      default:
        return '';
    }
  } catch {
    return '（payload 结构异常，仅显示基本信息）';
  }
}

async function doClone(t: TemplateRow) {
  await cloneTemplate(t.id);
  await refresh();
  message.success('已复制为可编辑副本');
}

async function doDelete(t: TemplateRow) {
  try {
    await deleteTemplate(t.id);
    await refresh();
  } catch (e) {
    message.error((e as Error).message);
  }
}

function doExport(t: TemplateRow) {
  downloadText(exportTemplate(t), `${t.name}.tcs-template.json`);
}

async function doImport() {
  const files = await pickJsonFiles();
  if (!files.length) return;
  try {
    await importTemplate(await files[0]!.text());
    await refresh();
    message.success('模板已导入');
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function createNew() {
  try {
    const payload = JSON.parse(newForm.value.json);
    await saveTemplate({ kind: newForm.value.kind, name: newForm.value.name, payload });
    showNew.value = false;
    await refresh();
    message.success('模板已创建');
  } catch (e) {
    message.error(`payload 不是合法 JSON：${(e as Error).message}`);
  }
}

/* 把当前卡沉淀为卡片模板 */
const cardOptions = computed(() => ws.cards.filter((c) => !c.deletedAt).map((c) => ({ label: c.name, value: c.id })));
const sinkCardId = ref<string | null>(null);
const sinkName = ref('');
const showSink = ref(false);

async function sinkFromCard() {
  if (!sinkCardId.value) return;
  const row = await cardService.getCard(sinkCardId.value);
  if (!row) return;
  const d = row.card.data as Record<string, unknown>;
  const payload = {
    spec: row.card.spec === 'chara_card_v3' ? 'v3' : 'v2',
    summary: `从卡片「${row.name}」沉淀`,
    fields: ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']
      .filter((k) => String(d[k] ?? '').trim())
      .map((k) => ({ key: k, label: k, hint: String(d[k]).slice(0, 60), initial: String(d[k]) })),
    defaultTags: row.tags,
  };
  await saveTemplate({ kind: 'card', name: sinkName.value || `${row.name}（沉淀）`, payload });
  await refresh();
  showSink.value = false;
  message.success('已沉淀为卡片模板（含当前字段结构）');
}
</script>

<template>
  <div style="max-width: 980px">
    <NSpace :size="10" style="margin-bottom: 12px">
      <NButton size="small" type="primary" @click="showNew = true">
        <template #icon><NIcon><AddOutline /></NIcon></template>新建模板
      </NButton>
      <NButton size="small" secondary @click="doImport">
        <template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入
      </NButton>
      <NButton size="small" secondary @click="showSink = true">
        <template #icon><NIcon><LayersOutline /></NIcon></template>从当前卡沉淀模板
      </NButton>
    </NSpace>

    <NTabs v-model:value="kind" type="segment" size="small">
      <NTabPane v-for="k in (['card', 'statusbar', 'regex', 'prompt'] as TemplateKind[])" :key="k" :name="k"
        :tab="{ card: '卡片模板', statusbar: '状态栏模板', regex: '正则模板', prompt: '提示词库' }[k]">
        <NEmpty v-if="!byKind.length" description="这个分类还没有模板" />
        <NSpace v-else vertical :size="10">
          <NCard v-for="t in byKind" :key="t.id" size="small">
            <template #header>
              <NSpace :size="8" align="center">
                <b>{{ t.name }}</b>
                <NTag v-if="t.builtin" size="tiny" round :bordered="false" type="success">内置</NTag>
                <NTag v-else size="tiny" round :bordered="false">自定义</NTag>
              </NSpace>
            </template>
            <template #header-extra>
              <NSpace :size="4">
                <NButton size="tiny" quaternary @click="doClone(t)">
                  <template #icon><NIcon><CopyOutline /></NIcon></template>复制
                </NButton>
                <NButton size="tiny" quaternary @click="doExport(t)">
                  <template #icon><NIcon><DownloadOutline /></NIcon></template>导出
                </NButton>
                <NPopconfirm v-if="!t.builtin" @positive-click="doDelete(t)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">
                      <template #icon><NIcon><TrashOutline /></NIcon></template>
                    </NButton>
                  </template>
                  删除模板？
                </NPopconfirm>
              </NSpace>
            </template>
            <div style="font-size: 12px; opacity: .75">{{ t.description }}</div>
            <div class="tpl-preview">{{ preview(t) }}</div>
          </NCard>
        </NSpace>
      </NTabPane>
    </NTabs>

    <NModal v-model:show="showNew" preset="card" title="新建模板" style="width: 600px">
      <NForm label-placement="top" size="small">
        <NFormItem label="分类">
          <NRadioGroup v-model:value="newForm.kind" size="small">
            <NRadioButton value="card">卡片</NRadioButton>
            <NRadioButton value="statusbar">状态栏</NRadioButton>
            <NRadioButton value="regex">正则</NRadioButton>
            <NRadioButton value="prompt">提示词</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="名称"><NInput v-model:value="newForm.name" /></NFormItem>
        <NFormItem label="payload（JSON，结构参考同类内置模板）">
          <CodeEditor v-model="newForm.json" language="javascript" height="220px" />
        </NFormItem>
        <NSpace justify="end">
          <NButton size="small" @click="showNew = false">取消</NButton>
          <NButton size="small" type="primary" @click="createNew">创建</NButton>
        </NSpace>
      </NForm>
    </NModal>

    <NModal v-model:show="showSink" preset="card" title="从当前卡沉淀模板" style="width: 480px">
      <NForm label-placement="top" size="small">
        <NFormItem label="选择卡片">
          <NSelect v-model:value="sinkCardId" :options="cardOptions" filterable placeholder="选卡" />
        </NFormItem>
        <NFormItem label="模板名"><NInput v-model:value="sinkName" placeholder="留空则用「卡名（沉淀）」" /></NFormItem>
        <NSpace justify="end">
          <NButton size="small" @click="showSink = false">取消</NButton>
          <NButton size="small" type="primary" :disabled="!sinkCardId" @click="sinkFromCard">沉淀</NButton>
        </NSpace>
      </NForm>
    </NModal>
  </div>
</template>

<style scoped>
.tpl-preview {
  margin-top: 6px; font-size: 12px; color: #a78bfa;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
</style>
