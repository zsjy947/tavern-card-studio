/** 内置暗色主题（仿 One Dark，免去额外依赖） */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const oneDark = EditorView.theme(
  {
    '&': {
      color: '#abb2bf',
      backgroundColor: '#282c34',
    },
    '.cm-content': {
      caretColor: '#61afef',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#61afef',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#3e4451',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,.035)',
    },
    '.cm-gutters': {
      backgroundColor: '#282c34',
      color: '#5c6370',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255,255,255,.05)',
    },
  },
  { dark: true },
);

export const oneDarkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c678dd' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#e06c75' },
  { tag: [t.propertyName], color: '#e5c07b' },
  { tag: [t.variableName, t.function(t.variableName)], color: '#61afef' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#e5c07b' },
  { tag: [t.definition(t.name), t.separator], color: '#abb2bf' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: '#e5c07b' },
  { tag: [t.operator, t.operatorKeyword], color: '#56b6c2' },
  { tag: [t.url, t.escape, t.regexp, t.link], color: '#98c379' },
  { tag: [t.meta, t.comment], color: '#5c6370' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#61afef', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#e06c75' },
  { tag: t.atom, color: '#56b6c2' },
  { tag: t.bool, color: '#d19a66' },
  { tag: t.string, color: '#98c379' },
]);

export const oneDarkBundle = [oneDark, syntaxHighlighting(oneDarkHighlight)];
