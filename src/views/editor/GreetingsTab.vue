<script setup lang="ts">
/** 描述与开场白 Tab：description / first_mes / alternate_greetings / mes_example + HTML 预览 */
import { computed, ref } from 'vue';
import {
  NForm, NFormItem, NInput, NSpace, NButton, NList, NListItem, NTag, NTabs, NTab, useMessage, NIcon, NEmpty,
} from 'naive-ui';
import { AddOutline, TrashOutline, EyeOutline } from '@vicons/ionicons5';
import type { AnyCard } from '@/core/card';
import TokenBadge from '@/components/TokenBadge.vue';
import FieldAiButton from '@/components/FieldAiButton.vue';
import HtmlPreview from '@/components/HtmlPreview.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const greetings = computed<string[]>(() => (data.value.alternate_greetings as string[]) ?? []);
const previewWhich = ref<'first' | number>('first');

function set(field: string, v: unknown) {
  data.value[field] = v;
  emit('change');
}

function addGreeting() {
  set('alternate_greetings', [...greetings.value, '']);
  previewWhich.value = greetings.value.length - 1;
}

function removeGreeting(i: number) {
  const next = [...greetings.value];
  next.splice(i, 1);
  set('alternate_greetings', next);
  // 删除后同步预览索引：预览位在删除位之后时前移一位，避免指向错条目
  if (previewWhich.value === i) previewWhich.value = 'first';
  else if (typeof previewWhich.value === 'number' && previewWhich.value > i) previewWhich.value = previewWhich.value - 1;
}

const previewHtml = computed(() => {
  const src = previewWhich.value === 'first'
    ? String(data.value.first_mes ?? '')
    : greetings.value[previewWhich.value as number] ?? '';
  // 基本按酒馆的段落渲染：换行分段；不执行脚本（安全）
  return src
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
    .join('');
});
</script>

<template>
  <NTabs type="segment" size="small" default-value="fields">
    <NTab name="fields" tab="字段编辑">
      <NForm label-placement="top" size="small" style="max-width: 860px">
        <NFormItem label="描述（description）——单人卡人设核心 / 多人卡世界与规则总述（多人卡可留空，成员设定放世界书）">
          <div class="field-block">
            <div class="field-toolbar">
              <TokenBadge :text="String(data.description ?? '')" :warn-at="3000" />
              <FieldAiButton field="description" field-label="描述" :model-value="String(data.description ?? '')" :card="card"
                @update:model-value="(v: string) => set('description', v)" />
            </div>
            <NInput type="textarea" :rows="12" :value="String(data.description ?? '')" @update:value="(v: string) => set('description', v)"
              placeholder="身份/外貌/性格/说话风格/与 {{user}} 的关系。推荐 markdown 分节 + 要点式" />
          </div>
        </NFormItem>

        <NFormItem label="开场白（first_mes）">
          <div class="field-block">
            <div class="field-toolbar">
              <TokenBadge :text="String(data.first_mes ?? '')" :warn-at="1500" />
              <FieldAiButton field="first_mes" field-label="开场白" :model-value="String(data.first_mes ?? '')" :card="card"
                @update:model-value="(v: string) => set('first_mes', v)" />
              <NButton size="tiny" tertiary @click="previewWhich = 'first'">
                <template #icon><NIcon><EyeOutline /></NIcon></template>预览
              </NButton>
            </div>
            <NInput type="textarea" :rows="8" :value="String(data.first_mes ?? '')" @update:value="(v: string) => set('first_mes', v)"
              placeholder="开场叙事，用 {{user}} 指代玩家，结尾留钩子。支持 HTML（美化模板的占位符也放这里）" />
          </div>
        </NFormItem>

        <NFormItem>
          <template #label>
            <NSpace align="center" :size="8">
              <span>备选开场白（alternate_greetings）</span>
              <NButton size="tiny" dashed @click="addGreeting">
                <template #icon><NIcon><AddOutline /></NIcon></template>添加
              </NButton>
            </NSpace>
          </template>
          <div class="field-block">
            <NEmpty v-if="!greetings.length" size="small" description="还没有备选开场白" style="padding: 12px 0" />
            <NList v-else bordered size="small" style="margin-bottom: 8px">
              <NListItem v-for="(g, i) in greetings" :key="i">
                <div class="greet-item">
                  <NInput type="textarea" :rows="4" :value="g"
                    @update:value="(v: string) => { const n = [...greetings]; n[i] = v; set('alternate_greetings', n); }" />
                  <NSpace :size="4" vertical>
                    <NButton size="tiny" tertiary @click="previewWhich = i">预览</NButton>
                    <NButton size="tiny" tertiary type="error" @click="removeGreeting(i)">
                      <template #icon><NIcon><TrashOutline /></NIcon></template>
                    </NButton>
                  </NSpace>
                </div>
              </NListItem>
            </NList>
            <FieldAiButton field="alternate_greetings" field-label="备选开场白" :model-value="greetings[0] ?? String(data.first_mes ?? '')" :card="card"
              @update:model-value="(v: string) => { set('alternate_greetings', [...greetings, v]); message.success('已追加一个备选开场白'); }" />
          </div>
        </NFormItem>

        <NFormItem label="对话示例（mes_example）——示范口吻">
          <div class="field-block">
            <div class="field-toolbar">
              <TokenBadge :text="String(data.mes_example ?? '')" :warn-at="1000" />
              <FieldAiButton field="mes_example" field-label="对话示例" :model-value="String(data.mes_example ?? '')" :card="card"
                @update:model-value="(v: string) => set('mes_example', v)" />
            </div>
            <NInput type="textarea" :rows="6" :value="String(data.mes_example ?? '')" @update:value="(v: string) => set('mes_example', v)"
              placeholder="&lt;START&gt;&#10;{{char}}: …&#10;{{user}}: …" />
          </div>
        </NFormItem>
      </NForm>
    </NTab>

    <NTab name="preview" tab="开场白渲染预览">
      <NSpace vertical size="small">
        <NSpace :size="6" align="center">
          <NButton size="tiny" :type="previewWhich === 'first' ? 'primary' : 'default'" @click="previewWhich = 'first'">主开场白</NButton>
          <NButton v-for="(_, i) in greetings" :key="i" size="tiny" :type="previewWhich === i ? 'primary' : 'default'" @click="previewWhich = i">
            备选 {{ i + 1 }}
          </NButton>
        </NSpace>
        <HtmlPreview :html="previewHtml" height="480px" />
        <NTag size="small" :bordered="false" type="info">预览容器尽量复刻酒馆消息渲染；脚本不在预览中执行，最终效果请在 SillyTavern 验证</NTag>
      </NSpace>
    </NTab>
  </NTabs>
</template>

<style scoped>
.field-block { width: 100%; }
.field-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.greet-item { display: flex; gap: 8px; width: 100%; }
</style>
