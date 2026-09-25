<script setup lang="ts">
/**
 * iframe sandbox 实时 HTML 预览（状态栏/开场白美化效果）。
 * 复刻酒馆消息容器的浅色底与字体设定，缩小与真机的渲染差异。
 */
import { computed, ref, watch } from 'vue';
import { NButton, NSpace, NTag } from 'naive-ui';

const props = defineProps<{
  html: string;
  css?: string;
  js?: string;
  /** 预览主题：模仿酒馆深/浅消息气泡 */
  theme?: 'dark' | 'light';
  height?: string;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const key = ref(0);

const doc = computed(() => {
  const bg = props.theme === 'light' ? '#f7f7f8' : '#101014';
  const fg = props.theme === 'light' ? '#1f2328' : '#d7d7de';
  const mq = props.theme === 'light' ? '#57606a' : '#8b8b96';
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:12px;background:${bg};color:${fg};
    font-family:'Segoe UI','Microsoft YaHei',system-ui,sans-serif;font-size:14px;line-height:1.65;}
  #mes_content p{margin:.5em 0;}
  img{max-width:100%;}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-thumb{background:${mq};border-radius:3px}
</style>
<style>${props.css ?? ''}</style>
</head><body><div id="mes_content">${props.html || '<span style="opacity:.4">（空）</span>'}</div>
<script>${props.js ?? ''}<\/script></body></html>`;
});

watch(doc, () => {
  key.value++;
});
</script>

<template>
  <div class="html-preview">
    <div class="html-preview-frame-wrap">
      <iframe
        :key="key"
        ref="frame"
        class="html-preview-frame"
        :style="{ height: height ?? '320px' }"
        sandbox="allow-same-origin"
        :srcdoc="doc"
      />
    </div>
    <div v-if="$slots.footer" class="html-preview-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.html-preview { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.html-preview-frame-wrap { border: 1px solid var(--tcs-border, rgba(255,255,255,.09)); border-radius: 10px; overflow: hidden; background: transparent; }
.html-preview-frame { width: 100%; border: 0; display: block; }
</style>
