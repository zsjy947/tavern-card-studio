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
/* 主题切换统一渐变：naive 给 body 的 .3s 过渡与消费 --tcs-* 变量的自绘层瞬时切换
   不同步（底色瞬换、文字慢追）。这里把 body 与主要面板/容器统一到 .25s 同节奏；
   收窄清单、不用 * 通配，hover 微交互不受影响。!important 压过 naive 动态注入的同名规则 */
body,
.tcs-backdrop,
.n-card,
.n-modal,
.n-drawer,
.n-input,
.n-base-selection,
.n-tag,
.n-list-item,
.n-collapse-item,
.cm-editor {
  transition: background-color .25s ease, color .25s ease, border-color .25s ease !important;
}
.tcs-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(--tcs-bg, #101014);
  background-image: var(--tcs-texture, none);
}
/* 布局面板透明化：让纹理底面透出（覆盖 naive 自带的布局底色）。
   注意：NLayoutContent :native-scrollbar="false" 下滚动视口是 .n-scrollbar-container，
   不存在 .n-layout-scroll-container 节点 */
.tcs-app .n-layout,
.tcs-app .n-layout-sider,
.tcs-app .n-layout-header,
.tcs-app .n-scrollbar-container {
  background: transparent;
}
/* 内层 NLayout 显式列布局：header 定高 + content flex:auto 真正生效，
   .n-scrollbar-container（height:100%）由此成为受限滚动视口——
   GuideView 目录、LibraryView 分类栏等 position:sticky 全部随之生效 */
.tcs-app > .n-layout {
  display: flex;
  flex-direction: column;
}
.tcs-app > .n-layout > .n-layout-content {
  min-height: 0;
}
</style>
