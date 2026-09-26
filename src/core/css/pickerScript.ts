/**
 * iframe 内元素点选 picker 脚本（ROADMAP P2-2）。
 * 以模板字符串注入 srcdoc：进入点选态后 mouseover 高亮（临时 outline，不污染模板 CSS）、
 * click 拦截并用 @medv/finder 生成最短唯一 CSS 选择器，postMessage 回父页；Esc 退出。
 * finder 以 `String(finder)` 序列化嵌入（@medv/finder 为零依赖自包含函数）。
 */
import { finder } from '@medv/finder';

export const PICKER_START_MESSAGE = 'tcs-picker-start';
export const PICKER_STOP_MESSAGE = 'tcs-picker-stop';
export const PICKED_MESSAGE = 'tcs-pick';
export const PICKER_ESC_MESSAGE = 'tcs-picker-esc';

/** 生成注入 iframe 的 picker 脚本（<script> 内容，不含标签） */
export function buildPickerScript(): string {
  return `
(function () {
  var finder = ${String(finder)};
  var picking = false;
  var highlighted = null;
  var prevOutline = '';
  var prevOffset = '';

  function clearHighlight() {
    if (highlighted) {
      highlighted.style.outline = prevOutline;
      highlighted.style.outlineOffset = prevOffset;
      highlighted = null;
    }
  }

  function highlight(el) {
    if (el === highlighted) return;
    clearHighlight();
    highlighted = el;
    prevOutline = el.style.outline;
    prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #8b5cf6';
    el.style.outlineOffset = '-1px';
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === ${JSON.stringify(PICKER_START_MESSAGE)}) { picking = true; }
    if (d.type === ${JSON.stringify(PICKER_STOP_MESSAGE)}) { picking = false; clearHighlight(); }
  });

  document.addEventListener('mouseover', function (e) {
    if (!picking) return;
    highlight(e.target);
  }, true);

  document.addEventListener('click', function (e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    var selector;
    try { selector = finder(e.target); } catch (err) { selector = null; }
    parent.postMessage({ type: ${JSON.stringify(PICKED_MESSAGE)}, selector: selector, tag: e.target.tagName }, '*');
  }, true);

  document.addEventListener('keydown', function (e) {
    if (picking && e.key === 'Escape') {
      picking = false;
      clearHighlight();
      parent.postMessage({ type: ${JSON.stringify(PICKER_ESC_MESSAGE)} }, '*');
    }
  }, true);
})();
`.trim();
}
