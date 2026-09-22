<script setup lang="ts">
/** 基础信息 Tab：name/personality/scenario/tags/creator/system_prompt 等 */
import { computed } from 'vue';
import { NForm, NFormItem, NInput, NSelect, NDynamicTags, NSpace } from 'naive-ui';
import type { AnyCard } from '@/core/card';
import TokenBadge from '@/components/TokenBadge.vue';
import FieldAiButton from '@/components/FieldAiButton.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();

const data = computed(() => props.card.data as Record<string, unknown>);

function set(field: string, v: unknown) {
  data.value[field] = v;
  emit('change');
}
</script>

<template>
  <NForm label-placement="top" size="small" class="tab-form">
    <div class="field-row">
      <NFormItem label="角色名（{{char}} 指向它）" required>
        <NInput :value="String(data.name ?? '')" @update:value="(v: string) => set('name', v)" placeholder="角色名" />
      </NFormItem>
      <NFormItem v-if="card.spec === 'chara_card_v3'" label="昵称（V3）">
        <NInput :value="String(data.nickname ?? '')" @update:value="(v: string) => set('nickname', v)" placeholder="昵称/别名" />
      </NFormItem>
    </div>

    <NFormItem label="性格（personality）">
      <div class="field-block">
        <div class="field-toolbar">
          <TokenBadge :text="String(data.personality ?? '')" :warn-at="600" />
          <FieldAiButton field="personality" field-label="性格" :model-value="String(data.personality ?? '')" :card="card"
            @update:model-value="(v: string) => set('personality', v)" />
        </div>
        <NInput type="textarea" :rows="3" :value="String(data.personality ?? '')" @update:value="(v: string) => set('personality', v)"
          placeholder="性格关键词与行为倾向，如：外冷内热，嘴上毒舌但会把伞悄悄塞给 {{user}}" />
      </div>
    </NFormItem>

    <NFormItem label="场景（scenario）">
      <div class="field-block">
        <div class="field-toolbar">
          <TokenBadge :text="String(data.scenario ?? '')" :warn-at="800" />
          <FieldAiButton field="scenario" field-label="场景" :model-value="String(data.scenario ?? '')" :card="card"
            @update:model-value="(v: string) => set('scenario', v)" />
        </div>
        <NInput type="textarea" :rows="3" :value="String(data.scenario ?? '')" @update:value="(v: string) => set('scenario', v)"
          placeholder="故事开场的时空与情境" />
      </div>
    </NFormItem>

    <div class="field-row">
      <NFormItem label="标签（tags）">
        <NDynamicTags :value="(data.tags as string[]) ?? []" @update:value="(v: string[]) => set('tags', v)" />
      </NFormItem>
      <NFormItem label="作者（creator）">
        <NInput :value="String(data.creator ?? '')" @update:value="(v: string) => set('creator', v)" />
      </NFormItem>
      <NFormItem label="版本（character_version）">
        <NInput :value="String(data.character_version ?? '')" @update:value="(v: string) => set('character_version', v)" />
      </NFormItem>
    </div>

    <NFormItem label="系统提示（system_prompt，覆盖酒馆默认；留空即不覆盖）">
      <div class="field-block">
        <div class="field-toolbar">
          <TokenBadge :text="String(data.system_prompt ?? '')" :warn-at="1200" />
          <FieldAiButton field="system_prompt" field-label="系统提示" :model-value="String(data.system_prompt ?? '')" :card="card"
            @update:model-value="(v: string) => set('system_prompt', v)" />
        </div>
        <NInput type="textarea" :rows="4" :value="String(data.system_prompt ?? '')" @update:value="(v: string) => set('system_prompt', v)" />
      </div>
    </NFormItem>

    <NFormItem label="贴身指令（post_history_instructions，每次请求末尾注入）">
      <div class="field-block">
        <div class="field-toolbar">
          <TokenBadge :text="String(data.post_history_instructions ?? '')" :warn-at="1200" />
          <FieldAiButton field="post_history_instructions" field-label="贴身指令" :model-value="String(data.post_history_instructions ?? '')" :card="card"
            @update:model-value="(v: string) => set('post_history_instructions', v)" />
        </div>
        <NInput type="textarea" :rows="4" :value="String(data.post_history_instructions ?? '')" @update:value="(v: string) => set('post_history_instructions', v)" />
      </div>
    </NFormItem>

    <NFormItem label="作者留言（creator_notes，给使用者的说明）">
      <NInput type="textarea" :rows="2" :value="String(data.creator_notes ?? '')" @update:value="(v: string) => set('creator_notes', v)" />
    </NFormItem>
  </NForm>
</template>

<style scoped>
.tab-form { max-width: 860px; }
.field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0 14px; }
.field-block { width: 100%; }
.field-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
</style>
