<script setup lang="ts">
/**
 * iframe sandbox 实时 HTML 预览（状态栏/开场白美化效果）。
 * 复刻酒馆消息容器的浅色底与字体设定，缩小与真机的渲染差异。
 *
 * picker 模式（ROADMAP P2-2）：enablePicker 开启后注入点选脚本（@medv/finder），
 * 父页调用 startPicker()/stopPicker() 控制点选态；点选结果经 postMessage 回父页
 * 并以 `pick` 事件抛出 `{ selector, tag }`。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useAppearance } from '@/stores/appearance';
import { buildPickerScript, PICKED_MESSAGE, PICKER_ESC_MESSAGE, PICKER_START_MESSAGE, PICKER_STOP_MESSAGE } from '@/core/css/pickerScript';

const props = defineProps<{
  html: string;
  css?: string;
  js?: string;
  /** 预览主题：模仿酒馆深/浅消息气泡；缺省跟随全局外观明暗 */
  theme?: 'dark' | 'light';
  height?: string;
  /** 允许 iframe 内脚本执行（AI 状态栏 tab 切换/元素点选需要；默认关闭以最小化沙箱权限） */
  allowScripts?: boolean;
  /** 开启元素点选（隐含 allowScripts） */
  enablePicker?: boolean;
}>();

const emit = defineEmits<{
  pick: [payload: { selector: string | null; tag: string }];
  pickerEsc: [];
}>();

const appearance = useAppearance();
const effectiveTheme = computed<'dark' | 'light'>(() => {
  if (props.theme) return props.theme;
  return appearance.theme.mode === 'light' ? 'light' : 'dark';
});

const frame = ref<HTMLIFrameElement | null>(null);
const key = ref(0);

const doc = computed(() => {
  const bg = effectiveTheme.value === 'light' ? '#f7f7f8' : '#101014';
  const fg = effectiveTheme.value === 'light' ? '#1f2328' : '#d7d7de';
  const mq = effectiveTheme.value === 'light' ? '#57606a' : '#8b8b96';
  const picker = props.enablePicker ? `<script>${buildPickerScript()}<\/script>` : '';
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
<script>${props.js ?? ''}<\/script>${picker}</body></html>`;
});

watch(doc, () => {
  key.value++;
});

/* ---- picker postMessage 桥 ---- */

function onMessage(e: MessageEvent) {
  if (!props.enablePicker) return;
  const d = e.data as { type?: string; selector?: string | null; tag?: string } | null;
  if (!d || typeof d !== 'object') return;
  if (d.type === PICKED_MESSAGE) {
    emit('pick', { selector: d.selector ?? null, tag: String(d.tag ?? '') });
  } else if (d.type === PICKER_ESC_MESSAGE) {
    emit('pickerEsc');
  }
}

window.addEventListener('message', onMessage);
onBeforeUnmount(() => window.removeEventListener('message', onMessage));

function startPicker() {
  frame.value?.contentWindow?.postMessage({ type: PICKER_START_MESSAGE }, '*');
}

function stopPicker() {
  frame.value?.contentWindow?.postMessage({ type: PICKER_STOP_MESSAGE }, '*');
}

defineExpose({ startPicker, stopPicker });
</script>

<template>
  <div class="html-preview">
    <div class="html-preview-frame-wrap">
      <iframe
        :key="key"
        ref="frame"
        class="html-preview-frame"
        :class="{ 'html-preview-picking': enablePicker }"
        :style="{ height: height ?? '320px' }"
        :sandbox="allowScripts || enablePicker ? 'allow-scripts' : 'allow-same-origin'"
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
.html-preview-picking { cursor: crosshair; }
</style>
