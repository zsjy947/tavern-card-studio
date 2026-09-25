<script setup lang="ts">
/** 正则 Tab：简化/高级双模式 + 实时测试预览 */
import { computed, ref } from 'vue';
import {
  NSpace, NButton, NList, NListItem, NSwitch, NInput, NFormItem, NTag, useMessage, NIcon,
  NRadioGroup, NRadioButton, NSelect, NInputNumber, NDrawer, NDrawerContent, NForm, NEmpty, NTooltip, NText,
} from 'naive-ui';
import { AddOutline, TrashOutline, FlashOutline } from '@vicons/ionicons5';
import type { AnyCard, RegexScript } from '@/core/card';
import { newRegexScript, applyRegexScript, compileFindRegex, validateRegexScript, PLACEMENT_LABELS } from '@/core/regex';
import CodeEditor from '@/components/CodeEditor.vue';
import { listTemplates } from '@/services/templateService';
import type { TemplateRow } from '@/services/types';
import type { RegexPayload } from '@/builtins/regexTemplates';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const ext = computed(() => (data.value.extensions ?? {}) as { regex_scripts?: RegexScript[] });
const scripts = computed<RegexScript[]>(() => ext.value.regex_scripts ?? []);

const PLACEMENT_OPTIONS = Object.entries(PLACEMENT_LABELS).map(([value, label]) => ({ value: Number(value), label }));

function mutate(fn: (arr: RegexScript[]) => void) {
  const next = JSON.parse(JSON.stringify(scripts.value)) as RegexScript[];
  fn(next);
  const e = { ...ext.value, regex_scripts: next };
  data.value.extensions = e;
  emit('change');
}

function add() {
  mutate((arr) => arr.push(newRegexScript()));
}

function patch(i: number, p: Partial<RegexScript>) {
  mutate((arr) => {
    arr[i] = { ...arr[i]!, ...p };
  });
}

function remove(i: number) {
  mutate((arr) => arr.splice(i, 1));
}

const mode = ref<'simple' | 'advanced'>('simple');
/** 每个脚本条目的折叠状态（默认展开，点击「收起」折叠正文） */
const collapsed = ref<Set<number>>(new Set());

function toggleCollapse(i: number) {
  const next = new Set(collapsed.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  collapsed.value = next;
}

/* ---------------- 实时测试 ---------------- */
const sampleText = ref('角色轻声说："你好，{{user}}。"\n<think>内心：好紧张…</think>\n<StatusPlaceHolder/>');

const testOutput = computed(() => {
  let out = sampleText.value;
  for (const s of scripts.value) {
    if (s.disabled) continue;
    try {
      out = applyRegexScript(s, out);
    } catch {
      /* 语法错误跳过 */
    }
  }
  return out;
});

const scriptErrors = computed(() => scripts.value.map((s) => validateRegexScript(s)));

/* ---------------- 模板库 ---------------- */
const regexTemplates = ref<TemplateRow[]>([]);
async function loadTemplates() {
  if (!regexTemplates.value.length) regexTemplates.value = await listTemplates('regex');
}
void loadTemplates();

function applyTemplate(row: TemplateRow) {
  const payload = row.payload as RegexPayload;
  mutate((arr) => arr.push(newRegexScript(payload.script)));
  message.success(`已从模板添加「${row.name}」`);
}
</script>

<template>
  <NSpace vertical :size="12">
    <NSpace :size="8" align="center">
      <NButton size="small" type="primary" @click="add">
        <template #icon><NIcon><AddOutline /></NIcon></template>新建脚本
      </NButton>
      <NRadioGroup v-model:value="mode" size="small">
        <NRadioButton value="simple">简化模式</NRadioButton>
        <NRadioButton value="advanced">高级模式</NRadioButton>
      </NRadioGroup>
      <NTooltip>
        <template #trigger>
          <NTag size="small" :bordered="false" type="info">模板库（点击应用）</NTag>
        </template>
        简化模式只改查找/替换/位置；高级模式开放全部 ST 字段
      </NTooltip>
      <NButton v-for="t in regexTemplates" :key="t.id" size="tiny" tertiary @click="applyTemplate(t)">{{ t.name }}</NButton>
    </NSpace>

    <NEmpty v-if="!scripts.length" description="没有正则脚本" size="small" />
    <NList v-else bordered size="small">
      <NListItem v-for="(s, i) in scripts" :key="s.id">
        <div class="rx-item">
          <div class="rx-head">
            <NInput size="small" :value="s.scriptName" style="width: 180px" placeholder="脚本名"
              @update:value="(v: string) => patch(i, { scriptName: v })" />
            <NTag size="small" :bordered="false" :type="scriptErrors[i]?.length ? 'error' : 'success'">
              {{ scriptErrors[i]?.length ? scriptErrors[i]![0] : '语法 OK' }}
            </NTag>
            <NSwitch size="small" :value="!s.disabled" @update:value="(v: boolean) => patch(i, { disabled: !v })">
              <template #checked>启用</template><template #unchecked>停用</template>
            </NSwitch>
            <NButton size="tiny" quaternary type="error" @click="remove(i)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
            </NButton>
            <NButton size="tiny" quaternary @click="toggleCollapse(i)">
              {{ collapsed.has(i) ? '展开' : '收起' }}
            </NButton>
          </div>
          <div v-show="!collapsed.has(i)" class="rx-body">
            <div class="rx-field">
              <span class="rx-label">查找</span>
              <NInput size="small" :value="s.findRegex" placeholder="/pattern/flags 或裸 pattern"
                @update:value="(v: string) => patch(i, { findRegex: v })" />
            </div>
            <div class="rx-field">
              <span class="rx-label">替换</span>
              <NInput size="small" :value="s.replaceString" placeholder="替换串（支持 {{user}}/{{char}} 宏）"
                @update:value="(v: string) => patch(i, { replaceString: v })" />
            </div>
            <div v-if="mode === 'advanced'" class="rx-advanced">
              <div class="rx-field">
                <span class="rx-label">位置</span>
                <NSelect multiple size="small" :value="s.placement" :options="PLACEMENT_OPTIONS" style="min-width: 200px"
                  @update:value="(v: number[]) => patch(i, { placement: v })" />
              </div>
              <div class="rx-field">
                <span class="rx-label">minDepth</span>
                <NInputNumber size="small" :value="s.minDepth" clearable @update:value="(v: number | null) => patch(i, { minDepth: v })" />
              </div>
              <div class="rx-field">
                <span class="rx-label">maxDepth</span>
                <NInputNumber size="small" :value="s.maxDepth" clearable @update:value="(v: number | null) => patch(i, { maxDepth: v })" />
              </div>
              <div class="rx-field">
                <span class="rx-label">仅显示</span>
                <NSwitch size="small" :value="s.markdownOnly" @update:value="(v: boolean) => patch(i, { markdownOnly: v })" />
              </div>
              <div class="rx-field">
                <span class="rx-label">仅提示</span>
                <NSwitch size="small" :value="s.promptOnly" @update:value="(v: boolean) => patch(i, { promptOnly: v })" />
              </div>
              <div class="rx-field">
                <span class="rx-label">编辑时运行</span>
                <NSwitch size="small" :value="s.runOnEdit" @update:value="(v: boolean) => patch(i, { runOnEdit: v })" />
              </div>
            </div>
            <div v-if="mode === 'advanced'" class="rx-field">
              <span class="rx-label">trim（每行一个）</span>
              <NInput size="small" type="textarea" :rows="2" :value="s.trimStrings.join('\n')"
                @update:value="(v: string) => patch(i, { trimStrings: v.split('\n').filter(Boolean) })" />
            </div>
          </div>
        </div>
      </NListItem>
    </NList>

    <div class="rx-tester">
      <div class="rx-tester-title">
        <NIcon><FlashOutline /></NIcon> 实时测试（按上方脚本顺序应用）
      </div>
      <div class="rx-tester-grid">
        <div>
          <NText depth="3" style="font-size: 12px">示例文本</NText>
          <NInput v-model:value="sampleText" type="textarea" :rows="8" />
        </div>
        <div>
          <NText depth="3" style="font-size: 12px">替换结果</NText>
          <div class="rx-tester-out">{{ testOutput || '（空）' }}</div>
        </div>
      </div>
    </div>
  </NSpace>
</template>

<style scoped>
.rx-item { width: 100%; }
.rx-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.rx-body { display: flex; flex-direction: column; gap: 6px; }
.rx-field { display: flex; align-items: center; gap: 8px; }
.rx-label { flex: none; width: 72px; font-size: 12px; opacity: .7; text-align: right; }
.rx-advanced { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.rx-tester { border: 1px dashed rgba(139,92,246,.35); border-radius: 10px; padding: 12px; }
.rx-tester-title { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 8px; }
.rx-tester-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rx-tester-out { white-space: pre-wrap; background: var(--tcs-editor-bg, rgba(0,0,0,.3)); border-radius: 8px; padding: 8px 10px; min-height: 180px; font-size: 13px; line-height: 1.6; }
</style>
