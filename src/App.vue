<script setup lang="ts">
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider,
  zhCN, dateZhCN,
} from 'naive-ui';
import { useAppearance } from '@/stores/appearance';

const appearance = useAppearance();
// initSync 立即上色（localStorage 快路径），init 异步校准设置库并注册字体
appearance.init();
</script>

<template>
  <NConfigProvider :theme="appearance.naiveTheme" :theme-overrides="appearance.themeOverrides"
    :locale="zhCN" :date-locale="dateZhCN" style="height: 100%">
    <NMessageProvider placement="top-right">
      <NDialogProvider>
        <NNotificationProvider placement="bottom-right">
          <RouterView />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
  <!-- 全屏纹理底面：z-index -1 垫底，布局面板置透明后透出 -->
  <div class="tcs-backdrop" aria-hidden="true" />
</template>

<style>
/* 界面字体：naive-ui 注入的 body { font-family: 默认 token } 不吃 overrides，
   这里以同选择器 + !important 接管（组件均从 body 继承字体） */
body {
  font-family: var(--tcs-font-ui, 'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif) !important;
}
.tcs-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(--tcs-bg, #101014);
  background-image: var(--tcs-texture, none);
}
/* 布局面板透明化：让纹理底面透出（覆盖 naive 自带的布局底色） */
.tcs-app .n-layout,
.tcs-app .n-layout-sider,
.tcs-app .n-layout-header,
.tcs-app .n-layout .n-layout-scroll-container {
  background: transparent;
}
</style>
