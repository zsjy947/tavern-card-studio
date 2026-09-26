/**
 * E2E 开发脚本（ROADMAP P3-1 / 迭代六 C2）：
 * 以 remote-debugging 端口启动 Tauri dev 构建，供 Playwright chromium.connectOverCDP 附加。
 * Playwright 自带 Chromium ≠ 真实 WebView2 引擎——本项目连的就是真实实例，规避「假信心」。
 *
 * 用法（两个终端）：
 *   1) npm run e2e:dev     # 启动带调试端口的 dev 应用（桌面需 WebView2；纯浏览器模式可跳过）
 *   2) npm run e2e         # 跑 tests/e2e 金路径
 */
import { spawn } from 'node:child_process';

const PORT = 9222;

const env = {
  ...process.env,
  // Tauri (WebView2) 传参：Windows 官方机制
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
};

console.log(`[e2e] 启动 tauri dev（CDP: http://127.0.0.1:${PORT}）…`);
const child = spawn('npx', ['tauri', 'dev'], { stdio: 'inherit', shell: true, env });

child.on('exit', (code) => process.exit(code ?? 0));
