/**
 * Playwright 配置：本项目 E2E 不用自带 Chromium（≠真实 WebView2 引擎，会给假信心），
 * 而是 connectOverCDP 附加到 scripts/e2e-dev.mjs 启动的真实 WebView2。
 * 因此不用 playwright 的 webServer/server 机制，仅作 test runner。
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
