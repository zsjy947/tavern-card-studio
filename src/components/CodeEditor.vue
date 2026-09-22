<script setup lang="ts">
/** CodeMirror 6 轻封装（JS / HTML） */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDarkBundle as oneDark } from './oneDark';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: 'javascript' | 'html' | 'text';
    readonly?: boolean;
    height?: string;
  }>(),
  { language: 'text', height: '260px' },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

onMounted(() => {
  if (!host.value) return;
  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
    }),
  ];
  if (props.language === 'javascript') extensions.push(javascript());
  if (props.language === 'html') extensions.push(html());

  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue ?? '',
      extensions: [...extensions, EditorState.readOnly.of(props.readonly ?? false)],
    }),
    parent: host.value,
  });
});

watch(
  () => props.modelValue,
  (v) => {
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v ?? '' } });
    }
  },
);

onBeforeUnmount(() => view?.destroy());

defineExpose({ focus: () => view?.focus() });
</script>

<template>
  <div ref="host" class="code-editor" :style="{ height }" />
</template>

<style scoped>
.code-editor {
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  overflow: hidden;
  background: #282c34;
}
.code-editor :deep(.cm-editor) { height: 100%; font-size: 13px; }
.code-editor :deep(.cm-scroller) { font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; }
</style>
