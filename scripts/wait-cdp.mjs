/**
 * 等待 CDP 端口就绪（E2E CI / scripts/e2e-dev.mjs 配套）：
 * 轮询 <url>/json/version 直到 200。tauri dev 首次 Rust 全量编译可能 15~25 分钟，
 * 默认超时 25 分钟（CI job timeout-minutes 内留出跑用例的余量）。
 *
 * 用法：node scripts/wait-cdp.mjs [url] [timeoutMs]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:9222/json/version';
const timeoutMs = Number(process.argv[3] ?? 25 * 60_000);

const start = Date.now();
for (;;) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`[wait-cdp] CDP 就绪：${url}（等待 ${Math.round((Date.now() - start) / 1000)}s）`);
      process.exit(0);
    }
  } catch {
    /* 未就绪，继续轮询 */
  }
  if (Date.now() - start > timeoutMs) {
    console.error(`[wait-cdp] 超时（${Math.round(timeoutMs / 1000)}s）：${url} 不可达——tauri dev 是否启动成功？（runner 需带 WebView2 运行时）`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
