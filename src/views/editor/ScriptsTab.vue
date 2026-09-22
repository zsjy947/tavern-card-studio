<script setup lang="ts">
/** 脚本 Tab：酒馆助手脚本（TavernHelper）编辑，CodeMirror JS */
import { computed, ref } from 'vue';
import {
  NSpace, NButton, NList, NListItem, NInput, NSwitch, NTag, useMessage, NIcon, NEmpty, NFormItem, NSelect,
} from 'naive-ui';
import { AddOutline, TrashOutline } from '@vicons/ionicons5';
import type { AnyCard, TavernHelperScript } from '@/core/card';
import { newHelperScript } from '@/core/script';
import CodeEditor from '@/components/CodeEditor.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const th = computed(() => ((data.value.extensions as Record<string, unknown>)?.tavern_helper ?? {}) as { scripts?: TavernHelperScript[] });
const scripts = computed<TavernHelperScript[]>(() => th.value.scripts ?? []);

function mutate(fn: (arr: TavernHelperScript[]) => void) {
  const next = JSON.parse(JSON.stringify(scripts.value)) as TavernHelperScript[];
  fn(next);
  const ext = { ...((data.value.extensions as Record<string, unknown>) ?? {}) };
  ext.tavern_helper = { ...th.value, scripts: next };
  data.value.extensions = ext;
  emit('change');
}

function add() {
  mutate((arr) => arr.push(newHelperScript({ content: '// 酒馆助手脚本（TavernHelper）\n// 可用：getVariables() / setVariables() / triggerSlash 等\n' })));
}

function patch(i: number, p: Partial<TavernHelperScript>) {
  mutate((arr) => {
    arr[i] = { ...arr[i]!, ...p };
  });
}

function remove(i: number) {
  mutate((arr) => arr.splice(i, 1));
}

const EVENT_OPTIONS = [
  { label: '不自动运行', value: '' },
  { label: '聊天消息渲染后', value: 'CHARACTER_MESSAGE_RENDERED' },
  { label: '用户消息渲染后', value: 'USER_MESSAGE_RENDERED' },
  { label: '应用启动', value: 'APP_READY' },
  { label: '进入聊天', value: 'CHAT_CHANGED' },
];
</script>

<template>
  <NSpace vertical :size="10">
    <NSpace :size="8" align="center">
      <NButton size="small" type="primary" @click="add">
        <template #icon><NIcon><AddOutline /></NIcon></template>新建助手脚本
      </NButton>
      <NTag size="small" :bordered="false" type="info">TavernHelper 脚本随卡分发（extensions.tavern_helper.scripts）</NTag>
    </NSpace>

    <NEmpty v-if="!scripts.length" description="没有脚本（美化三件套的变量逻辑可写在这里）" size="small" />
    <NList v-else bordered size="small">
      <NListItem v-for="(s, i) in scripts" :key="s.id">
        <div class="sc-item">
          <div class="sc-head">
            <NInput size="small" :value="s.name" style="width: 160px" placeholder="脚本名" @update:value="(v: string) => patch(i, { name: v })" />
            <NInput size="small" :value="s.comment" style="width: 220px" placeholder="备注" @update:value="(v: string) => patch(i, { comment: v })" />
            <NFormItem label="触发" label-placement="left" size="small">
              <NSelect size="small" :value="s.event" :options="EVENT_OPTIONS" style="width: 180px" @update:value="(v: string) => patch(i, { event: v })" />
            </NFormItem>
            <NSwitch size="small" :value="s.enabled" @update:value="(v: boolean) => patch(i, { enabled: v })">
              <template #checked>启用</template><template #unchecked>停用</template>
            </NSwitch>
            <NButton size="tiny" quaternary type="error" @click="remove(i)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
            </NButton>
          </div>
          <CodeEditor :model-value="s.content" language="javascript" height="200px"
            @update:model-value="(v: string) => patch(i, { content: v })" />
        </div>
      </NListItem>
    </NList>
  </NSpace>
</template>

<style scoped>
.sc-item { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.sc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
