import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  // hash 模式：file:// 与 Tauri 协议下都能路由
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    {
      path: '/',
      component: () => import('@/views/LayoutView.vue'),
      children: [
        { path: 'library', name: 'library', component: () => import('@/views/LibraryView.vue'), meta: { title: '卡库' } },
        { path: 'preview/:id', name: 'preview', component: () => import('@/views/PreviewView.vue'), meta: { title: '卡片预览' } },
        { path: 'editor/:id', name: 'editor', component: () => import('@/views/EditorView.vue'), meta: { title: '卡片编辑器' } },
        { path: 'compare', name: 'compare', component: () => import('@/views/CompareView.vue'), meta: { title: '两卡对比' } },
        { path: 'converter', name: 'converter', component: () => import('@/views/ConverterView.vue'), meta: { title: '转换工具' } },
        { path: 'wizard', name: 'wizard', component: () => import('@/views/WizardView.vue'), meta: { title: '生成向导' } },
        { path: 'beautify', name: 'beautify', component: () => import('@/views/BeautifyView.vue'), meta: { title: '美化工作台' } },
        { path: 'templates', name: 'templates', component: () => import('@/views/TemplateCenterView.vue'), meta: { title: '模板中心' } },
        { path: 'ai', name: 'ai', component: () => import('@/views/AiCenterView.vue'), meta: { title: 'AI 中心' } },
        { path: 'diagnosis', name: 'diagnosis', component: () => import('@/views/DiagnosisView.vue'), meta: { title: '诊断与调整' } },
        { path: 'xray', name: 'xray', component: () => import('@/views/PromptXrayView.vue'), meta: { title: '组装透视' } },
        { path: 'novel', name: 'novel', component: () => import('@/views/NovelWorkshopView.vue'), meta: { title: '同人卡工坊' } },
        { path: 'stats', name: 'stats', component: () => import('@/views/StatsView.vue'), meta: { title: '统计看板' } },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置与备份' } },
        { path: 'guide', name: 'guide', component: () => import('@/views/GuideView.vue'), meta: { title: '使用指南' } },
      ],
    },
  ],
});
