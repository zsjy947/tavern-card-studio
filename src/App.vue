<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider,
  darkTheme, zhCN, dateZhCN, type GlobalThemeOverrides,
} from 'naive-ui';

const themeOverrides = ref<GlobalThemeOverrides>({
  common: {
    primaryColor: '#8b5cf6',
    primaryColorHover: '#a78bfa',
    primaryColorPressed: '#7c3aed',
    primaryColorSuppl: '#a78bfa',
    borderRadius: '8px',
    fontFamily: `'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif`,
  },
});

const theme = computed(() => darkTheme);
</script>

<template>
  <NConfigProvider :theme="theme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN"
    style="height: 100%">
    <NMessageProvider placement="top-right">
      <NDialogProvider>
        <NNotificationProvider placement="bottom-right">
          <RouterView />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
