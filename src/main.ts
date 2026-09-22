import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { ensureSeeded } from './services/templateService';
import { seedSkills } from './builtins/skills';
import { getStore } from './db';

async function bootstrap() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');

  // 首启播种内置模板与 skill（失败不阻塞 UI）
  try {
    await getStore();
    await ensureSeeded();
    await seedSkills();
  } catch (e) {
    console.error('初始化内置模板失败：', e);
  }
}

void bootstrap();
