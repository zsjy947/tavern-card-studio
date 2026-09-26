import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { ensureSeeded } from './services/templateService';
import { seedSkills } from './builtins/skills';
import { getStore } from './db';
import { i18n, initI18n } from './i18n';

async function bootstrap() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.mount('#app');

  // 首启播种内置模板与 skill（失败不阻塞 UI）
  try {
    await getStore();
    await ensureSeeded();
    await seedSkills();
  } catch (e) {
    console.error('初始化内置模板失败：', e);
  }

  // i18n 语言校准（懒加载 locale；失败保持默认中文）
  void initI18n().catch((e) => console.error('i18n 初始化失败：', e));
}

void bootstrap();
