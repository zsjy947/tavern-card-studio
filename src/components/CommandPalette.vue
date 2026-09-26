<script setup lang="ts">
/** Ctrl+K 命令面板：命令注册表 + 模糊搜索 + 键盘导航 */
import { computed, ref, watch } from 'vue';
import { NModal, NInput, NTag, NEmpty, NIcon } from 'naive-ui';
import { SearchOutline, ArrowForwardOutline } from '@vicons/ionicons5';
import { searchCommands, type CommandItem } from '@/composables/useCommandPalette';

const show = defineModel<boolean>('show', { default: false });
const query = ref('');
const activeIndex = ref(0);

const results = computed<CommandItem[]>(() => searchCommands(query.value));

watch(show, (v) => {
  if (v) {
    query.value = '';
    activeIndex.value = 0;
  }
});

watch(results, () => {
  activeIndex.value = 0;
});

async function execute(cmd: CommandItem) {
  show.value = false;
  await cmd.run();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cmd = results.value[activeIndex.value];
    if (cmd) void execute(cmd);
  }
}
</script>

<template>
  <NModal v-model:show="show" transform-origin="center" style="width: 560px; max-width: 92vw">
    <div class="palette">
      <div class="palette-input">
        <NIcon size="18" class="palette-icon"><SearchOutline /></NIcon>
        <NInput v-model:value="query" placeholder="搜索命令 / 页面 / 最近卡片…（↑↓ 选择，Enter 执行）"
          bordered placement="left" @keydown="onKeydown" autofocus style="border: none" />
      </div>
      <div class="palette-list">
        <NEmpty v-if="!results.length" size="small" description="没有匹配的命令" style="padding: 24px 0" />
        <div
          v-for="(cmd, i) in results" :key="cmd.id"
          class="palette-item" :class="{ 'palette-item-active': i === activeIndex }"
          @mouseenter="activeIndex = i" @click="execute(cmd)"
        >
          <NTag size="tiny" :bordered="false" round>{{ cmd.group }}</NTag>
          <span class="palette-title">{{ cmd.title }}</span>
          <NIcon class="palette-go"><ArrowForwardOutline /></NIcon>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.palette {
  background: var(--tcs-overlay, #18181f); border: 1px solid var(--tcs-accent-border, rgba(139, 92, 246, 0.35));
  border-radius: 14px; overflow: hidden; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}
.palette-input { display: flex; align-items: center; padding: 8px 12px; gap: 8px; border-bottom: 1px solid var(--tcs-border, rgba(255,255,255,.07)); }
.palette-icon { opacity: 0.6; flex: none; }
.palette-list { max-height: 380px; overflow: auto; padding: 6px; }
.palette-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.palette-item:hover, .palette-item-active { background: var(--tcs-accent-soft, rgba(139, 92, 246, 0.14)); }
.palette-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette-go { opacity: 0; font-size: 13px; }
.palette-item:hover .palette-go, .palette-item-active .palette-go { opacity: 0.6; }
</style>
