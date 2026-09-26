<script setup lang="ts">
import { computed } from 'vue';
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider,
  zhCN, dateZhCN, enUS, dateEnUS,
} from 'naive-ui';
import { useAppearance } from '@/stores/appearance';
import { i18n } from '@/i18n';

const appearance = useAppearance();
// initSync 立即上色（localStorage 快路径），init 异步校准设置库并注册字体
appearance.init();

// naive-ui locale 跟随界面语言（i18n 骨架）
const naiveLocale = computed(() => (i18n.global.locale.value === 'en-US' ? enUS : zhCN));
const naiveDateLocale = computed(() => (i18n.global.locale.value === 'en-US' ? dateEnUS : dateZhCN));
</script>

<template>
  <NConfigProvider :theme="appearance.naiveTheme" :theme-overrides="appearance.themeOverrides"
    :locale="naiveLocale" :date-locale="naiveDateLocale" style="height: 100%">
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
/* 布局滚动几何根治：
   两级 n-layout 各自渲染 .n-layout-scroll-container（默认都参与滚动，header 会随页滚走，
   且 NLayoutContent 被内容撑高、overflow:hidden 形成假滚动位使 position:sticky 全部失效）。
   这里让两级 scroll-container 都不滚动、内层改列布局，使 NLayoutContent 内部的
   .n-scrollbar-container 成为唯一受限滚动视口——指南目录/卡库分类栏等 sticky 随之生效 */
.tcs-app > .n-layout-scroll-container,
.tcs-app > .n-layout-scroll-container > .n-layout > .n-layout-scroll-container {
  height: 100%;
  overflow: hidden;
}
.tcs-app > .n-layout-scroll-container > .n-layout > .n-layout-scroll-container {
  display: flex;
  flex-direction: column;
}
.tcs-app .n-layout-content {
  flex: 1 1 0%;
  min-height: 0;
}
</style>
