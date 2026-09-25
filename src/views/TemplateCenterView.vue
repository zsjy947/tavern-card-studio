<script setup lang="ts">
/** 模板中心：四类模板管理 + 导入导出 + 从卡沉淀（字段/正则/状态栏）+ 按 kind 结构化编辑 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NTabs, NTabPane, NCard, NTag, useMessage, NIcon, NEmpty, NPopconfirm, NInput, NModal, NForm, NFormItem, NSelect, NRadioGroup, NRadioButton, NCheckbox, NCheckboxGroup, NText,
} from 'naive-ui';
import { AddOutline, TrashOutline, CopyOutline, DownloadOutline, CloudUploadOutline, LayersOutline, CreateOutline } from '@vicons/ionicons5';
import { listTemplates, deleteTemplate, cloneTemplate, exportTemplate, importTemplate, saveTemplate, updateTemplate } from '@/services/templateService';
import type { TemplateRow, TemplateKind } from '@/services/types';
import type { CardTemplatePayload, CardTemplateField } from '@/builtins/cardTemplates';
import type { PromptPayload } from '@/builtins/promptTemplates';
import type { StatusbarPayload, StatusbarVariable } from '@/builtins/statusbarTemplates';
import type { RegexPayload } from '@/builtins/regexTemplates';
import type { RegexScript } from '@/core/card';
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

/* ---------------- 结构化编辑（builtin 自动落副本） ---------------- */

const showEdit = ref(false);
const editId = ref<string | null>(null);
const editName = ref('');
const editDesc = ref('');
/** 工作副本（深拷贝 payload，保存时写回） */
const editPayload = ref<Record<string, unknown>>({});

function clonePayload(p: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(p ?? {})) as Record<string, unknown>;
}

async function openEdit(t: TemplateRow) {
  let target = t;
  if (t.builtin) {
    // builtin 不可覆盖：自动创建可编辑副本后编辑副本
    target = await cloneTemplate(t.id, `${t.name}（编辑副本）`);
    await refresh();
    message.info(`「${t.name}」是内置模板，已自动创建可编辑副本`);
  }
  editId.value = target.id;
  editName.value = target.name;
  editDesc.value = target.description ?? '';
  editPayload.value = clonePayload(target.payload);
  showEdit.value = true;
}

async function saveEdit() {
  if (!editId.value) return;
  try {
    await updateTemplate(editId.value, { name: editName.value, description: editDesc.value, payload: editPayload.value });
    showEdit.value = false;
    await refresh();
    message.success('模板已保存');
  } catch (e) {
    message.error((e as Error).message);
  }
}

/* --- card 编辑辅助 --- */
const cardFields = computed(() => (editPayload.value.fields as CardTemplateField[] | undefined) ?? []);
function addCardField() {
  const p = editPayload.value;
  p.fields = [...cardFields.value, { key: `field_${cardFields.value.length + 1}`, label: '新字段', hint: '' }];
}
function removeCardField(i: number) {
  const p = editPayload.value;
  p.fields = cardFields.value.filter((_, idx) => idx !== i);
}

/* --- statusbar 变量编辑辅助 --- */
const sbVars = computed(() => (editPayload.value.variables as StatusbarVariable[] | undefined) ?? []);
function addSbVar() {
  const p = editPayload.value;
  let key = 'new_var';
  let i = 1;
  while (sbVars.value.some((v) => v.key === key)) key = `new_var_${++i}`;
  p.variables = [...sbVars.value, { key, label: '新变量', initial: '' }];
}
function removeSbVar(i: number) {
  const p = editPayload.value;
  p.variables = sbVars.value.filter((_, idx) => idx !== i);
}

/* --- regex 编辑辅助 --- */
const regexScript = computed(() => (editPayload.value.script as RegexScript | undefined) ?? ({} as RegexScript));
function patchRegex(p: Partial<RegexScript>) {
  editPayload.value.script = { ...regexScript.value, ...p };
}

/* ---------------- 从当前卡沉淀模板（字段/正则/状态栏） ---------------- */

const cardOptions = computed(() => ws.cards.filter((c) => !c.deletedAt).map((c) => ({ label: c.name, value: c.id })));
const sinkCardId = ref<string | null>(null);
const sinkName = ref('');
const showSink = ref(false);

/** 选中卡后扫描出的正则脚本（id → script），勾选沉淀 */
const sinkRegexScripts = ref<{ id: string; name: string; find: string; script: RegexScript }[]>([]);
const sinkRegexSelected = ref<string[]>([]);
/** 扫描出的状态栏元数据（插入三件套时随脚本/条目入库） */
const sinkStatusbar = ref<{ source: string; payload: StatusbarPayload } | null>(null);

watch(sinkCardId, async (id) => {
  sinkRegexScripts.value = [];
  sinkRegexSelected.value = [];
  sinkStatusbar.value = null;
  if (!id) return;
  const row = await cardService.getCard(id);
  if (!row) return;
  const d = row.card.data as Record<string, unknown>;
  const ext = (d.extensions ?? {}) as { regex_scripts?: RegexScript[] };
  sinkRegexScripts.value = (ext.regex_scripts ?? []).map((s) => ({
    id: s.id, name: s.scriptName || s.id, find: s.findRegex, script: s,
  }));
  sinkRegexSelected.value = sinkRegexScripts.value.map((s) => s.id);
  // 状态栏元数据：优先正则脚本，其次世界书条目
  for (const s of ext.regex_scripts ?? []) {
    const meta = (s as unknown as { extensions?: { tcsStatusbarPayload?: StatusbarPayload } }).extensions?.tcsStatusbarPayload;
    if (meta) {
      sinkStatusbar.value = { source: `正则「${s.scriptName}」`, payload: meta };
      break;
    }
  }
  if (!sinkStatusbar.value) {
    const book = (d.character_book ?? { entries: [] }) as { entries: { comment?: string; extensions?: { tcsStatusbarPayload?: StatusbarPayload } }[] };
    for (const e of book.entries) {
      const meta = e.extensions?.tcsStatusbarPayload;
      if (meta) {
        sinkStatusbar.value = { source: `世界书「${e.comment ?? '?'}」`, payload: meta };
        break;
      }
    }
  }
});

async function sinkFromCard() {
  if (!sinkCardId.value) return;
  const row = await cardService.getCard(sinkCardId.value);
  if (!row) return;
  const d = row.card.data as Record<string, unknown>;
  const payload: CardTemplatePayload = {
    spec: row.card.spec === 'chara_card_v3' ? 'v3' : 'v2',
    summary: `从卡片「${row.name}」沉淀`,
    fields: ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']
      .filter((k) => String(d[k] ?? '').trim())
      .map((k) => ({ key: k, label: k, hint: String(d[k]).slice(0, 60), initial: String(d[k]) })),
    defaultTags: row.tags,
  };
  await saveTemplate({ kind: 'card', name: sinkName.value || `${row.name}（沉淀）`, payload });

  // 勾选的正则脚本逐条沉淀为正则模板
  const picked = sinkRegexScripts.value.filter((s) => sinkRegexSelected.value.includes(s.id));
  for (const s of picked) {
    const { id: _drop, ...rest } = s.script;
    const rxPayload: RegexPayload = { script: rest, note: `从卡片「${row.name}」沉淀` };
    await saveTemplate({ kind: 'regex', name: `${s.name}（沉淀）`, payload: rxPayload });
  }

  // 状态栏模板沉淀（需插入时带出的元数据；旧卡无元数据则跳过）
  let sbSaved = false;
  if (sinkStatusbar.value) {
    await saveTemplate({ kind: 'statusbar', name: `${sinkStatusbar.value.payload.tag.replace(/[<>][/]/g, '')}（沉淀）`, payload: sinkStatusbar.value.payload });
    sbSaved = true;
  }

  await refresh();
  showSink.value = false;
  message.success(`已沉淀为卡片模板${picked.length ? ` + ${picked.length} 条正则模板` : ''}${sbSaved ? ' + 状态栏模板' : ''}`);
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
                <NButton size="tiny" quaternary @click="openEdit(t)">
                  <template #icon><NIcon><CreateOutline /></NIcon></template>编辑
                </NButton>
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

    <!-- 结构化编辑：按 kind 出表单；builtin 编辑时已自动落副本 -->
    <NModal v-model:show="showEdit" preset="card" :title="`编辑模板：${editName}`" style="width: 760px">
      <NForm v-if="showEdit" label-placement="top" size="small">
        <NSpace :size="10">
          <NFormItem label="名称" style="flex: 1"><NInput v-model:value="editName" /></NFormItem>
          <NFormItem label="描述" style="flex: 2"><NInput v-model:value="editDesc" /></NFormItem>
        </NSpace>

        <!-- card：字段表 -->
        <template v-if="templates.find((t) => t.id === editId)?.kind === 'card'">
          <NFormItem label="字段列表（key/label/hint 可编辑）">
            <div style="width: 100%">
              <div v-for="(f, i) in cardFields" :key="i" class="edit-row">
                <NInput v-model:value="f.key" size="small" placeholder="key" style="width: 150px" />
                <NInput v-model:value="f.label" size="small" placeholder="显示名" style="width: 150px" />
                <NInput v-model:value="f.hint" size="small" placeholder="填写提示" style="flex: 1" />
                <NButton size="tiny" quaternary type="error" @click="removeCardField(i)">
                  <template #icon><NIcon><TrashOutline /></NIcon></template>
                </NButton>
              </div>
              <NButton size="small" dashed style="margin-top: 6px" @click="addCardField">
                <template #icon><NIcon><AddOutline /></NIcon></template>添加字段
              </NButton>
            </div>
          </NFormItem>
          <NFormItem label="默认标签（逗号分隔）">
            <NInput :value="(editPayload.defaultTags as string[] | undefined)?.join(',') ?? ''"
              @update:value="(v: string) => (editPayload.defaultTags = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean))" />
          </NFormItem>
        </template>

        <!-- regex：单脚本编辑 -->
        <template v-else-if="templates.find((t) => t.id === editId)?.kind === 'regex'">
          <NFormItem label="脚本名"><NInput :value="regexScript.scriptName ?? ''" @update:value="(v: string) => patchRegex({ scriptName: v })" /></NFormItem>
          <NFormItem label="查找正则（如 /pattern/g）">
            <NInput :value="regexScript.findRegex ?? ''" @update:value="(v: string) => patchRegex({ findRegex: v })" />
          </NFormItem>
          <NFormItem label="替换为（$1 等捕获组可用）">
            <NInput type="textarea" :rows="4" :value="regexScript.replaceString ?? ''" @update:value="(v: string) => patchRegex({ replaceString: v })" />
          </NFormItem>
          <NFormItem label="作用位置（0 正文 / 1 用户输入 / 2 AI 输出）">
            <NInput :value="(regexScript.placement ?? []).join(',')"
              @update:value="(v: string) => patchRegex({ placement: v.split(/[,，\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n)) })" />
          </NFormItem>
          <NFormItem label="说明">
            <NInput type="textarea" :rows="2" :value="String(editPayload.note ?? '')" @update:value="(v: string) => (editPayload.note = v)" />
          </NFormItem>
        </template>

        <!-- statusbar：HTML/CSS/JS/变量 -->
        <template v-else-if="templates.find((t) => t.id === editId)?.kind === 'statusbar'">
          <NSpace :size="10">
            <NFormItem label="占位符 tag" style="width: 220px"><NInput v-model:value="editPayload.tag as string" /></NFormItem>
          </NSpace>
          <NFormItem label="HTML"><CodeEditor v-model="editPayload.html as string" language="html" height="160px" /></NFormItem>
          <NFormItem label="CSS"><CodeEditor v-model="editPayload.css as string" language="text" height="140px" /></NFormItem>
          <NFormItem label="JS"><CodeEditor v-model="editPayload.js as string" language="javascript" height="140px" /></NFormItem>
          <NFormItem label="变量（key / 显示名 / 初始值 / 分组）">
            <div style="width: 100%">
              <div v-for="(v, i) in sbVars" :key="i" class="edit-row">
                <NInput v-model:value="v.key" size="small" placeholder="key" style="width: 150px" />
                <NInput v-model:value="v.label" size="small" placeholder="显示名" style="width: 150px" />
                <NInput v-model:value="v.initial" size="small" placeholder="初始值" style="flex: 1" />
                <NInput :value="v.group ?? ''" size="small" placeholder="分组(可选)" style="width: 110px"
                  @update:value="(g: string) => (v.group = g || undefined)" />
                <NButton size="tiny" quaternary type="error" @click="removeSbVar(i)">
                  <template #icon><NIcon><TrashOutline /></NIcon></template>
                </NButton>
              </div>
              <NButton size="small" dashed style="margin-top: 6px" @click="addSbVar">
                <template #icon><NIcon><AddOutline /></NIcon></template>添加变量
              </NButton>
            </div>
          </NFormItem>
        </template>

        <!-- prompt：system/user -->
        <template v-else-if="templates.find((t) => t.id === editId)?.kind === 'prompt'">
          <NFormItem label="target（调用标识）"><NInput v-model:value="editPayload.target as string" /></NFormItem>
          <NFormItem label="system 提示词">
            <NInput type="textarea" :rows="6" v-model:value="editPayload.system as string" />
          </NFormItem>
          <NFormItem label="user 模板（{NAME} {CONTEXT} 等占位）">
            <NInput type="textarea" :rows="6" v-model:value="editPayload.userTemplate as string" />
          </NFormItem>
        </template>

        <NSpace justify="end">
          <NButton size="small" @click="showEdit = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveEdit">保存</NButton>
        </NSpace>
      </NForm>
    </NModal>

    <NModal v-model:show="showSink" preset="card" title="从当前卡沉淀模板" style="width: 560px">
      <NForm label-placement="top" size="small">
        <NFormItem label="选择卡片">
          <NSelect v-model:value="sinkCardId" :options="cardOptions" filterable placeholder="选卡" />
        </NFormItem>
        <NFormItem label="卡片模板名"><NInput v-model:value="sinkName" placeholder="留空则用「卡名（沉淀）」" /></NFormItem>

        <template v-if="sinkCardId">
          <NFormItem v-if="sinkRegexScripts.length" label="正则脚本沉淀（勾选的逐条存为正则模板）">
            <NCheckboxGroup v-model:value="sinkRegexSelected">
              <NSpace vertical :size="4">
                <NCheckbox v-for="s in sinkRegexScripts" :key="s.id" :value="s.id" :label="`${s.name}（${s.find.slice(0, 40)}…）`" />
              </NSpace>
            </NCheckboxGroup>
          </NFormItem>
          <NFormItem v-if="sinkStatusbar" label="状态栏模板沉淀">
            <NSpace vertical :size="4" style="width: 100%">
              <NTag size="small" type="success" :bordered="false">
                检测到状态栏元数据（来自{{ sinkStatusbar.source }}）：占位符 {{ sinkStatusbar.payload.tag }}，将一并沉淀为状态栏模板
              </NTag>
              <NText depth="3" style="font-size: 12px">旧卡（无元数据）不提供状态栏沉淀；用美化工作台重新插入即可获得元数据</NText>
            </NSpace>
          </NFormItem>
        </template>

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
  margin-top: 6px; font-size: 12px; color: var(--tcs-accent-text, #a78bfa);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.edit-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
</style>
