<script setup lang="ts">
import { h, computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NLayout, NLayoutSider, NLayoutContent, NLayoutHeader,
  NMenu, NSpace, NTag, NText, NIcon, NBadge, NButton, NDropdown,
  useNotification,
  type DropdownOption,
} from 'naive-ui';
import {
  AlbumsOutline, SwapHorizontalOutline, CreateOutline, ColorPaletteOutline,
  LayersOutline, CloudOutline, MedicalOutline, BookOutline, StatsChartOutline,
  SettingsOutline, SparklesOutline, TerminalOutline, GitCompareOutline,
  SchoolOutline, CheckmarkOutline, OptionsOutline,
} from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import { useAppearance } from '@/stores/appearance';
import { THEMES } from '@/core/theme';
import { isTauri } from '@/db/tauri';
import { consumeDegradedNotice } from '@/db';
import { useI18n } from 'vue-i18n';
import { registerCommand, unregisterCommand } from '@/composables/useCommandPalette';
import { registerShortcut, unregisterShortcut, installShortcutLayer } from '@/composables/useShortcuts';
import CommandPalette from '@/components/CommandPalette.vue';

const route = useRoute();
const router = useRouter();
const ws = useWorkspace();
const appearance = useAppearance();
const { t } = useI18n();
const notification = useNotification();
const collapsed = ref(false);
const paletteShow = ref(false);

function icon(C: typeof AlbumsOutline) {
  return () => h(NIcon, null, { default: () => h(C) });
}

const menuOptions = computed(() => [
  { label: t('nav.library'), key: '/library', icon: icon(AlbumsOutline) },
  { label: t('nav.wizard'), key: '/wizard', icon: icon(SparklesOutline) },
  { label: t('nav.converter'), key: '/converter', icon: icon(SwapHorizontalOutline) },
  { label: t('nav.beautify'), key: '/beautify', icon: icon(ColorPaletteOutline) },
  { label: t('nav.templates'), key: '/templates', icon: icon(LayersOutline) },
  { label: t('nav.ai'), key: '/ai', icon: icon(CloudOutline) },
  { label: t('nav.diagnosis'), key: '/diagnosis', icon: icon(MedicalOutline) },
  { label: t('nav.novel'), key: '/novel', icon: icon(BookOutline) },
  { label: t('nav.stats'), key: '/stats', icon: icon(StatsChartOutline) },
  { label: t('nav.settings'), key: '/settings', icon: icon(SettingsOutline) },
  { label: t('nav.guide'), key: '/guide', icon: icon(SchoolOutline) },
]);

const activeKey = computed(() => `/${(route.path.split('/')[1] ?? 'library')}`);

function onMenu(key: string) {
  router.push(key);
}

const runtimeTag = computed(() => (isTauri()
  ? { text: t('app.mode.desktop'), type: 'success' as const }
  : { text: t('app.mode.browser'), type: 'default' as const }));
const hasTextChannel = computed(() => ws.activeChannel('text'));

/* ---------------- 主题快捷切换（头部下拉 + 命令面板） ---------------- */

const themeOptions = computed<DropdownOption[]>(() => [
  ...THEMES.map((t) => ({
    key: t.id,
    label: () => h('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, [
      h('span', {
        style: `width:14px;height:14px;border-radius:4px;flex:none;border:1px solid var(--tcs-border);
          background-color:${t.palette.bg};background-image:${t.texture};background-size:120px;display:inline-block`,
      }),
      h('span', null, t.label),
      appearance.themeId === t.id
        ? h(NIcon, { size: 14, style: 'color: var(--tcs-accent)' }, { default: () => h(CheckmarkOutline) })
        : null,
    ]),
  })),
  { type: 'divider', key: 'theme-divider' },
  {
    key: 'appearance-settings',
    label: t('command.appearance'),
    icon: () => h(NIcon, null, { default: () => h(OptionsOutline) }),
  },
] as DropdownOption[]);

function onThemeSelect(key: string | number) {
  if (key === 'appearance-settings') {
    router.push('/settings');
    return;
  }
  void appearance.setTheme(String(key));
}

/* ---------------- 命令面板（Ctrl+K，注册表统一管理） ---------------- */

const paletteToggle = () => {
  paletteShow.value = !paletteShow.value;
};
registerShortcut({ id: 'global:ctrl-k', combo: 'Ctrl+K', scope: 'global', description: '打开/关闭命令面板', handler: paletteToggle });

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteToggle();
  }
}

const uninstallShortcuts = installShortcutLayer();

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown);
  // D3（技术债）：桌面 SQLite 降级提示全局化——挂载即一次性全局通知，不再等用户进设置页
  const degraded = consumeDegradedNotice();
  if (degraded !== null) {
    notification.error({
      title: '数据库已降级为浏览器存储',
      content: `桌面 SQLite 初始化失败：${degraded}。本次数据不完整（可用「导入」找回）；重启应用可重试，反复出现请反馈此错误信息。设置页可查看存储详情。`,
      duration: 12000,
      closable: true,
    });
  }
  // 启动即拉取卡与渠道：头部徽标（N 张卡 / AI 配置状态）不依赖用户先访问卡库或 AI 中心
  ws.refreshCards(true).catch((e) => console.error('卡列表启动加载失败：', e));
  ws.refreshChannels().catch((e) => console.error('渠道启动加载失败：', e));
  // 页面导航命令
  for (const opt of menuOptions.value) {
    registerCommand({ id: `nav:${opt.key}`, title: t('command.open', { name: opt.label }), group: t('command.groupNav'), keywords: opt.label, run: () => { void router.push(opt.key); } })
  }
  registerCommand({ id: 'nav:/compare', title: t('command.compare'), group: t('command.groupNav'), keywords: '对比 compare diff', run: () => { void router.push('/compare'); } });
  registerCommand({ id: 'palette:new-card', title: t('command.newCard'), group: t('command.groupOps'), keywords: '新建 卡片 create', run: async () => {
    const { createCard } = await import('@/services/cardService');
    const row = await createCard('新角色');
    await ws.refreshCards(true);
    router.push(`/editor/${row.id}`);
  } });
  for (const th of THEMES) {
    registerCommand({
      id: `theme:${th.id}`,
      title: t('command.switchTheme', { name: th.label }),
      group: t('command.groupTheme'),
      keywords: `主题 theme ${th.label} ${th.mode === 'dark' ? '深色' : '浅色'}`,
      run: () => { void appearance.setTheme(th.id); },
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  uninstallShortcuts();
  unregisterShortcut('global:ctrl-k');
  for (const opt of menuOptions.value) unregisterCommand(`nav:${opt.key}`);
  unregisterCommand('nav:/compare');
  unregisterCommand('palette:new-card');
  for (const th of THEMES) unregisterCommand(`theme:${th.id}`);
});
</script>

<template>
  <NLayout class="tcs-app" style="height: 100vh" has-sider>
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
          <NDropdown trigger="click" :options="themeOptions" @select="onThemeSelect">
            <NButton size="tiny" tertiary :title="`当前主题：${appearance.theme.label}`">
              <template #icon><NIcon><ColorPaletteOutline /></NIcon></template>
              {{ appearance.theme.label }}
            </NButton>
          </NDropdown>
          <NButton size="tiny" tertiary @click="paletteShow = true">
            <template #icon><NIcon><TerminalOutline /></NIcon></template>
            Ctrl K
          </NButton>
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

    <CommandPalette v-model:show="paletteShow" />
  </NLayout>
</template>

<style scoped>
.brand {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 18px 12px; font-weight: 800; letter-spacing: 1px;
}
.brand-collapsed { justify-content: center; padding: 16px 0 12px; }
.brand-mark {
  background: var(--tcs-brand-grad, linear-gradient(135deg, #8b5cf6, #d946ef));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  font-size: 17px;
}
.brand-name { color: var(--tcs-text-1, #e7e2f7); font-size: 15px; }
.sider-foot { display: flex; gap: 6px; padding: 12px 16px; flex-wrap: wrap; }
.app-header {
  display: flex; align-items: center; padding: 10px 22px; height: 46px;
}
.header-title { font-weight: 700; font-size: 14px; }
.app-content { padding: 18px 22px 40px; }
</style>
