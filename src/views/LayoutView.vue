<script setup lang="ts">
import { h, computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NLayout, NLayoutSider, NLayoutContent, NLayoutHeader,
  NMenu, NSpace, NTag, NText, NIcon, NBadge,
} from 'naive-ui';
import {
  AlbumsOutline, SwapHorizontalOutline, CreateOutline, ColorPaletteOutline,
  LayersOutline, CloudOutline, MedicalOutline, BookOutline, StatsChartOutline,
  SettingsOutline, SparklesOutline,
} from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import { isTauri } from '@/db/tauri';

const route = useRoute();
const router = useRouter();
const ws = useWorkspace();
const collapsed = ref(false);

function icon(C: typeof AlbumsOutline) {
  return () => h(NIcon, null, { default: () => h(C) });
}

const menuOptions = computed(() => [
  { label: '卡库', key: '/library', icon: icon(AlbumsOutline) },
  { label: '生成向导', key: '/wizard', icon: icon(SparklesOutline) },
  { label: '转换工具', key: '/converter', icon: icon(SwapHorizontalOutline) },
  { label: '美化工作台', key: '/beautify', icon: icon(ColorPaletteOutline) },
  { label: '模板中心', key: '/templates', icon: icon(LayersOutline) },
  { label: 'AI 中心', key: '/ai', icon: icon(CloudOutline) },
  { label: '诊断与调整', key: '/diagnosis', icon: icon(MedicalOutline) },
  { label: '同人卡工坊', key: '/novel', icon: icon(BookOutline) },
  { label: '统计看板', key: '/stats', icon: icon(StatsChartOutline) },
  { label: '设置与备份', key: '/settings', icon: icon(SettingsOutline) },
]);

const activeKey = computed(() => `/${(route.path.split('/')[1] ?? 'library')}`);

function onMenu(key: string) {
  router.push(key);
}

const runtimeTag = isTauri() ? { text: '桌面模式', type: 'success' as const } : { text: '浏览器模式', type: 'default' as const };
const hasTextChannel = computed(() => ws.activeChannel('text'));
</script>

<template>
  <NLayout style="height: 100vh" has-sider>
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="212"
      :collapsed="collapsed"
      show-trigger
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="brand" :class="{ 'brand-collapsed': collapsed }">
        <span class="brand-mark"> tavern </span>
        <span v-if="!collapsed" class="brand-name">Card Studio</span>
      </div>
      <NMenu :collapsed="collapsed" :collapsed-width="64" :options="menuOptions" :value="activeKey" @update:value="onMenu" />
      <div v-if="!collapsed" class="sider-foot">
        <NTag size="tiny" :type="runtimeTag.type" :bordered="false">{{ runtimeTag.text }}</NTag>
        <NTag v-if="!hasTextChannel" size="tiny" type="warning" :bordered="false">未配置 AI</NTag>
      </div>
    </NLayoutSider>

    <NLayout>
      <NLayoutHeader bordered class="app-header">
        <NSpace align="center" :size="10">
          <span class="header-title">{{ (route.meta.title as string) ?? '' }}</span>
        </NSpace>
        <NSpace align="center" :size="6" style="margin-left: auto">
          <NText depth="3" style="font-size: 12px">{{ ws.cards.length }} 张卡</NText>
          <NBadge :show="!hasTextChannel" dot type="warning" :offset="[-2, 2]">
            <NTag size="small" round :bordered="false" style="cursor: pointer" @click="router.push('/ai')">
              {{ hasTextChannel ? hasTextChannel.name : '配置 AI' }}
            </NTag>
          </NBadge>
        </NSpace>
      </NLayoutHeader>
      <NLayoutContent class="app-content" :native-scrollbar="false">
        <RouterView />
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>

<style scoped>
.brand {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 18px 12px; font-weight: 800; letter-spacing: 1px;
}
.brand-collapsed { justify-content: center; padding: 16px 0 12px; }
.brand-mark {
  background: linear-gradient(135deg, #8b5cf6, #d946ef);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  font-size: 17px;
}
.brand-name { color: #e7e2f7; font-size: 15px; }
.sider-foot { display: flex; gap: 6px; padding: 12px 16px; flex-wrap: wrap; }
.app-header {
  display: flex; align-items: center; padding: 10px 22px; height: 46px;
}
.header-title { font-weight: 700; font-size: 14px; }
.app-content { padding: 18px 22px 40px; }
</style>
