<script setup lang="ts">
/** 扩展 Tab：左侧扩展项列表 + 右侧编辑区；原始 JSON 走全屏抽屉，不再挤压布局 */
import { computed, ref, watch } from 'vue';
import {
  NSpace, NFormItem, NInput, NInputNumber, NSelect, NSwitch, NTag, useMessage, NDrawer, NDrawerContent, NButton, NIcon,
} from 'naive-ui';
import { CodeWorkingOutline } from '@vicons/ionicons5';
import type { AnyCard } from '@/core/card';
import CodeEditor from '@/components/CodeEditor.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const message = useMessage();

const data = computed(() => props.card.data as Record<string, unknown>);
const ext = computed(() => (data.value.extensions ?? {}) as Record<string, unknown>);
const depth = computed(
  () => (ext.value.depth_prompt ?? { prompt: '', depth: 4, role: 'system' }) as { prompt: string; depth: number; role: 'system' | 'user' | 'assistant' },
);

function setDepth(p: Partial<{ prompt: string; depth: number; role: string }>) {
  data.value.extensions = { ...ext.value, depth_prompt: { ...depth.value, ...p } };
  emit('change');
}

function setExtKey(key: string, v: unknown) {
  data.value.extensions = { ...ext.value, [key]: v };
  emit('change');
}

/* 左侧列表选中项 */
type Section = 'depth' | 'talk' | 'fav' | 'world' | 'raw';
const sections: { key: Section; label: string; desc: string }[] = [
  { key: 'depth', label: '深度注入', desc: 'depth_prompt' },
  { key: 'talk', label: '发言倾向', desc: 'talkativeness' },
  { key: 'fav', label: '收藏', desc: 'fav' },
  { key: 'world', label: '全局世界书', desc: 'world' },
  { key: 'raw', label: '原始 JSON', desc: '整卡直编' },
];
const active = ref<Section>('depth');

/* 原始 JSON 编辑（全屏抽屉；打开时重新序列化，保证拿到表单最新改动） */
const showRaw = ref(false);
const rawJson = ref('');
watch(showRaw, (open) => {
  if (open) rawJson.value = JSON.stringify(props.card, null, 2);
});
const rawError = ref('');

function applyRaw() {
  try {
    const parsed = JSON.parse(rawJson.value) as Record<string, unknown>;
    // 语法之外再做最小形状校验：缺 data 块或 entries 非数组的 JSON 会让编辑器其他 Tab 崩溃
    const problems: string[] = [];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push('根节点必须是对象');
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) problems.push('缺少 data 对象');
    const book = (parsed.data as Record<string, unknown> | undefined)?.character_book as { entries?: unknown } | undefined;
    if (book !== undefined && (!book.entries || !Array.isArray(book.entries))) problems.push('character_book.entries 必须是数组');
    if (problems.length) {
      rawError.value = problems.join('；');
      return;
    }
    // 原地替换 card 内容
    const target = props.card as unknown as Record<string, unknown>;
    Object.keys(target).forEach((k) => delete target[k]);
    Object.assign(target, parsed);
    rawError.value = '';
    emit('change');
    message.success('JSON 已应用（记得保存）');
  } catch (e) {
    rawError.value = (e as Error).message;
  }
}

const ROLE_OPTIONS = [
  { label: 'system', value: 'system' },
  { label: 'user', value: 'user' },
  { label: 'assistant', value: 'assistant' },
];
</script>

<template>
  <div class="ext-layout">
    <div class="ext-nav">
      <button
        v-for="s in sections" :key="s.key"
        class="ext-nav-item" :class="{ 'ext-nav-item-active': active === s.key }"
        @click="active = s.key"
      >
        <b>{{ s.label }}</b>
        <span class="ext-nav-desc">{{ s.desc }}</span>
      </button>
    </div>

    <div class="ext-body">
      <!-- 深度注入 -->
      <NSpace v-if="active === 'depth'" vertical :size="14" style="max-width: 760px">
        <NFormItem label="depth_prompt（深度注入的提示，随对话深度生效）">
          <div class="field-block">
            <NInput type="textarea" :rows="4" :value="depth.prompt" @update:value="(v: string) => setDepth({ prompt: v })" />
            <NSpace :size="12" style="margin-top: 8px" align="center">
              <span style="font-size: 12px; opacity: .7">深度</span>
              <NInputNumber size="small" :value="depth.depth" :min="0" :max="99" @update:value="(v: number | null) => setDepth({ depth: v ?? 4 })" />
              <span style="font-size: 12px; opacity: .7">角色</span>
              <NSelect size="small" :value="depth.role" :options="ROLE_OPTIONS" style="width: 120px"
                @update:value="(v: string) => setDepth({ role: v })" />
            </NSpace>
          </div>
        </NFormItem>
      </NSpace>

      <!-- 发言倾向 / 收藏 / 全局世界书 -->
      <NSpace v-else-if="active === 'talk' || active === 'fav' || active === 'world'" vertical :size="14" style="max-width: 560px">
        <NFormItem v-if="active === 'talk'" label="talkativeness（群聊主动发言倾向）">
          <NInputNumber size="small" :value="Number(ext.talkativeness ?? 0.5)" :min="0" :max="1" :step="0.1"
            @update:value="(v: number | null) => setExtKey('talkativeness', v ?? 0.5)" />
        </NFormItem>
        <NFormItem v-else-if="active === 'fav'" label="fav（收藏）">
          <NSwitch :value="Boolean(ext.fav)" @update:value="(v: boolean) => setExtKey('fav', v)" />
        </NFormItem>
        <template v-else>
          <NFormItem label="world（关联全局世界书名）">
            <NInput :value="String(ext.world ?? '')" @update:value="(v: string) => setExtKey('world', v)" placeholder="留空使用内嵌 character_book" />
          </NFormItem>
          <NTag :bordered="false" type="info" size="small">
            内嵌世界书在「世界书」页编辑；正则脚本在「正则」页；助手脚本在「脚本」页
          </NTag>
        </template>
      </NSpace>

      <!-- 原始 JSON 入口 -->
      <NSpace v-else-if="active === 'raw'" vertical :size="14" style="max-width: 560px">
        <NTag :bordered="false" type="warning" size="small">
          直接编辑整卡 JSON：适合批量粘贴/修复/社区卡微调。应用前会做形状校验，改坏会导致其他页异常
        </NTag>
        <NButton type="primary" secondary @click="showRaw = true">
          <template #icon><NIcon><CodeWorkingOutline /></NIcon></template>
          打开原始 JSON 编辑器
        </NButton>
      </NSpace>
    </div>
  </div>

  <!-- 全屏抽屉：raw 编辑不挤压布局 -->
  <NDrawer v-model:show="showRaw" :width="'100%'" style="max-width: 100vw">
    <NDrawerContent title="原始 JSON（整卡）" closable>
      <div class="raw-wrap">
        <CodeEditor v-model="rawJson" language="javascript" height="calc(100vh - 190px)" />
        <NSpace align="center" style="margin-top: 10px">
          <NButton type="primary" @click="applyRaw">应用 JSON</NButton>
          <NButton v-if="!rawError" quaternary @click="showRaw = false">关闭</NButton>
          <span v-if="rawError" style="color: var(--tcs-bad, #f87171); font-size: 12px">{{ rawError }}</span>
        </NSpace>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.ext-layout { display: flex; gap: 18px; align-items: flex-start; }
.ext-nav { display: flex; flex-direction: column; gap: 6px; width: 190px; flex-shrink: 0; }
.ext-nav-item {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  border: 1px solid var(--tcs-border, rgba(255,255,255,.08)); border-radius: 10px;
  background: transparent; padding: 10px 12px; cursor: pointer; font-size: 13px;
  transition: border-color .15s;
}
.ext-nav-item:hover { border-color: var(--tcs-accent-border, rgba(139,92,246,.4)); }
.ext-nav-item-active { border-color: var(--tcs-accent, #8b5cf6); background: var(--tcs-accent-soft, rgba(139,92,246,.08)); }
.ext-nav-desc { font-size: 11px; opacity: .55; }
.ext-body { flex: 1; min-width: 0; }
.field-block { width: 100%; }
.raw-wrap { height: 100%; }
</style>
