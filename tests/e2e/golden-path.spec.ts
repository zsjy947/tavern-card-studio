/**
 * E2E 金路径（ROADMAP P3-1 / 迭代六 C2）：
 * connectOverCDP 附加到真实 WebView2（scripts/e2e-dev.mjs 以 --remote-debugging-port=9222 启动），
 * 跑「启动 → 卡库 → 新建卡 → 编辑器改字段 → Ctrl+S 保存 → 预览页」金路径。
 *
 * 边界说明：
 * - LLM 相关不测（不依赖 API key）
 * - 文件导入/导出对话框在 CDP 桥不可控：文件导入由 13 张真实卡回归测试兜底，
 *   PNG 导出读回由 core/png/codec 单测与真机验收覆盖
 */
import { test, expect, chromium, type Browser } from '@playwright/test';

const CDP_URL = process.env.TCS_CDP_URL ?? 'http://127.0.0.1:9222';

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_URL);
});

test.afterAll(async () => {
  await browser.close();
});

async function appPage() {
  const context = browser.contexts()[0];
  expect(context, 'WebView2 上没有可附加的页面——请先 npm run e2e:dev').toBeTruthy();
  const page = context!.pages()[0]!;
  return page;
}

test('金路径：启动 → 新建卡 → 编辑保存 → 预览', async () => {
  const page = await appPage();

  // ① 应用已加载（hash 路由）
  await page.goto('#/library');
  await expect(page.getByText('新建角色卡')).toBeVisible();

  // ② 新建 → 进入编辑器
  await page.getByRole('button', { name: '新建角色卡' }).click();
  await expect(page).toHaveURL(/#\/editor\//, { timeout: 15_000 });

  // ③ 改角色名并保存（Ctrl+S）
  const nameInput = page.locator('input').first();
  await nameInput.fill('E2E 金路径卡');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 10_000 });

  // ④ 预览页只读可访问且显示改名
  await page.goto('#/library');
  const card = page.locator('.lib-card', { hasText: 'E2E 金路径卡' }).first();
  await card.dblclick();
  await expect(page).toHaveURL(/#\/preview\//, { timeout: 10_000 });
  await expect(page.getByText('E2E 金路径卡').first()).toBeVisible();
});
