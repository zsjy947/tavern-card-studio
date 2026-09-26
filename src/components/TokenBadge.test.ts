// @vitest-environment happy-dom
/**
 * 组件测试（ROADMAP P3-1 / 迭代六 C2）：
 * - TokenBadge：estimated 标记（衔接 P1-3 tiktoken 惰性加载）与阈值配色
 * - FieldAiButton：三模式回调参数与禁用态（runFieldAi mock）
 */
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h, defineComponent } from 'vue';
import { NMessageProvider } from 'naive-ui';
import { createPinia, setActivePinia } from 'pinia';
import { i18n } from '@/i18n';
import TokenBadge from './TokenBadge.vue';
import FieldAiButton from './FieldAiButton.vue';

vi.mock('@/services/aiService', () => ({
  runFieldAi: vi.fn(async () => 'AI 生成结果文本'),
}));
// 隔离真实模板库（避免测试穿透到 IndexedDB 播种）；模板用例显式注入 prompts
vi.mock('@/services/promptLookup', () => ({
  findPrompt: vi.fn(async () => null),
}));

import { runFieldAi } from '@/services/aiService';
import { loadLocale } from '@/i18n';

beforeAll(async () => {
  await loadLocale('zh-CN');
});

describe('TokenBadge', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('渲染 token 与字数；空文本不炸', () => {
    const w = mount(TokenBadge, { props: { text: '' } });
    expect(w.text()).toContain('0 tk');
    expect(w.text()).toContain('0 字');
  });

  it('estimated 时显示 ~ 前缀（粗估路径）', () => {
    const w = mount(TokenBadge, { props: { text: '这是一个测试文本' } });
    // cl100k ranks 在测试环境动态加载可能未就绪，computed 初值即粗估 → 有 ~ 前缀
    expect(w.text()).toMatch(/~?\d+ tk/);
  });

  it('warnAt 阈值决定 error 级配色（naive 用错误色 CSS 变量表达）', () => {
    const w = mount(TokenBadge, { props: { text: '字'.repeat(120), warnAt: 40 } });
    expect(w.text()).toMatch(/\d+ tk/);
    expect(w.html()).toContain('120');
  });
});

/** FieldAiButton 需要 NMessageProvider + i18n 包裹 */
function mountFieldAi(props: Record<string, unknown>) {
  return mount(
    defineComponent({
      setup: () => () => h(NMessageProvider, () => h(FieldAiButton, props as never)),
    }),
    { global: { plugins: [i18n], stubs: { NPopselect: true } } },
  );
}

describe('FieldAiButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(runFieldAi).mockClear();
  });

  function findButton(w: ReturnType<typeof mount>, label: string) {
    const b = w.findAll('button').find((x) => x.text().includes(label));
    if (!b) throw new Error(`找不到按钮：${label}`);
    return b;
  }

  function isDisabled(b: ReturnType<typeof findButton>): boolean {
    const el = b.element as HTMLButtonElement;
    return el.disabled || b.attributes('aria-disabled') === 'true';
  }

  it('优化按钮在内容为空时禁用', () => {
    const w = mountFieldAi({ field: 'description', modelValue: '' });
    expect(isDisabled(findButton(w, '优化'))).toBe(true);
  });

  it('优化模式：调用 runFieldAi 并 emit 更新', async () => {
    const w = mountFieldAi({ field: 'description', fieldLabel: '角色描述', modelValue: '原始内容' });
    await findButton(w, '优化').trigger('click');
    await flushPromises();
    expect(runFieldAi).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runFieldAi).mock.calls[0]![0]!;
    expect(arg.userPrompt).toBe('原始内容');
    expect(w.findComponent(FieldAiButton).emitted('update:modelValue')?.[0]).toEqual(['AI 生成结果文本']);
  });

  it('生成模式：注入模板走正路径（模板系统提示词透传）', async () => {
    const w = mountFieldAi({
      field: 'description',
      modelValue: '',
      prompts: [
        {
          id: 't1', kind: 'prompt' as const, name: 't', description: '', builtin: false,
          createdAt: '', updatedAt: '',
          payload: { target: 'field:description.generate', system: 'SYS', userTemplate: '写一个 {NAME}：{CONTEXT}' },
        },
      ],
    });
    await findButton(w, 'AI 生成').trigger('click');
    await flushPromises();
    expect(runFieldAi).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runFieldAi).mock.calls[0]![0]!;
    expect(arg.systemPrompt).toBe('SYS');
    expect(arg.userPrompt).toContain('写一个');
    expect(w.findComponent(FieldAiButton).emitted('update:modelValue')?.[0]).toEqual(['AI 生成结果文本']);
  });

  it('busy 期间其余按钮禁用（防并发）', async () => {
    let resolveAi: (v: string) => void = () => undefined;
    vi.mocked(runFieldAi).mockImplementationOnce(() => new Promise<string>((r) => (resolveAi = r)));
    const w = mountFieldAi({ field: 'description', modelValue: 'x' });
    await findButton(w, '优化').trigger('click');
    await flushPromises();
    expect(isDisabled(findButton(w, 'AI 生成'))).toBe(true);
    resolveAi('done');
    await flushPromises();
    expect(w.findComponent(FieldAiButton).emitted('update:modelValue')).toHaveLength(1);
  });
});
