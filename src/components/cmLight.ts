/**
 * 浅色 CodeMirror 主题「纸面」：颜色引用主题 CSS 变量（--tcs-*），
 * 一套定义同时适配晨白 / 书卷 / 竹林等浅色系主题。语法色为深色系，
 * 在米棕、淡青纸底上均有足够对比度。
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const paperLight = EditorView.theme(
  {
    '&': {
      color: 'var(--tcs-text-1)',
      backgroundColor: 'var(--tcs-editor-bg)',
    },
    '.cm-content': {
      caretColor: 'var(--tcs-accent)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--tcs-accent)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--tcs-accent-soft)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--tcs-editor-active)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--tcs-editor-bg)',
      color: 'var(--tcs-text-3)',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--tcs-editor-active)',
    },
  },
  { dark: false },
);

export const paperLightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#a626a4' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#c23f3f' },
  { tag: [t.propertyName], color: '#9a6b1f' },
  { tag: [t.variableName, t.function(t.variableName)], color: '#3d6db3' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#9a6b1f' },
  { tag: [t.definition(t.name), t.separator], color: '#4a4a52' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: '#9a6b1f' },
  { tag: [t.operator, t.operatorKeyword], color: '#2f7f86' },
  { tag: [t.url, t.escape, t.regexp, t.link], color: '#3f7d3f' },
  { tag: [t.meta, t.comment], color: '#8a8a92' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#3d6db3', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#c23f3f' },
  { tag: t.atom, color: '#2f7f86' },
  { tag: t.bool, color: '#b3541e' },
  { tag: t.string, color: '#3f7d3f' },
]);

export const paperLightBundle = [paperLight, syntaxHighlighting(paperLightHighlight)];
