# TavernCard Studio 待改进清单（ROADMAP）

> 按「功能增强 / 体验深化 / 工程与远期 / 审查遗留」分组，条目按优先级排序。
> 架构与已实现功能见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 一、已知事项（当前版本边界）

- 内嵌受限浏览器中 naive-ui 虚拟列表（NSelect 下拉）可能不渲染选项；真实 Chrome / Tauri WebView2 正常。
- 字体在线下载：桌面模式走 Rust 直连（无跨域限制）；浏览器模式受 CORS 限制，GitHub Releases 渠道字体不可下载（raw 仓库文件类可用），可用「导入本地字体」替代。
- 真实 LLM 渠道行为（GLM/DeepSeek 测连、流式对话、Rust 流式代理真机链路）需要配置渠道后人工验证；自动化测试覆盖到 mock fetch 层。
- Tauri 打包需本机 Rust 工具链；无 Rust 时浏览器模式运行全部功能（存储落 IndexedDB）。`npm run release` 后 `src-tauri/target` 被清理的话下次构建全量重编。

## 二、功能增强（P1，原优化文档未完成项）

1. **工坊流水线细粒度断点**：「一键抽取」拆为 extract → worldbook 两个可独立重跑的步骤，产物分别落 `pipelineState`（`extractedBase` 与 `worldbookEntries` 两键），失败只重跑当前步；每步完成度落 `stage`，UI 显示步骤级 ✓/↻。
2. **导出文件名模板**：导出目录已可配置（已实现），文件命名规则可配置（`{name}`/`{spec}`/`{date}` 占位）。
3. **tiktoken 按需加载**：`stats/tokens` 改惰性单例，首次调用动态 import（5.6MB chunk 拖慢首屏），就绪前返回粗估并标记 `estimated: true`；卡列表 token 徽章延迟刷新。
4. **转换器「最近转换」记录**：转换结果落 settings `recent_conversions`（上限 50），报告面板提供「重新下载」入口（>2MB 不留产物）。
5. **导入预设选项**：世界书保持内嵌 / 拆为 ST 全局世界书；正则随卡 / 导出独立脚本 JSON；预设可保存复用。

## 三、体验深化（P2）

1. **卡片市场式预览**：卡库双击进只读预览页（封面 + 开场白渲染 + 世界书条目折叠 + token 概览），「编辑」按钮才进编辑器。
2. **状态栏模板「元素点选定向改」**：预览 iframe 注入 postMessage 桥，点击元素回传 CSS 选择器，右侧高亮对应 CSS 规则块，改完实时重渲。
3. **AI 美化三件套生成**：提示词库新增 `beautify:trio`（卡简介 + 风格关键词 → `{html, css, js, variables[], worldinfoEntry}`）→ 直接进预览，产物作为用户模板入库。
4. **快捷键体系**：F2 重命名卡、表格式注册（命令面板复用）；Ctrl+K / Ctrl+S / Ctrl+Z·Y 已实现。

## 四、工程与远期（P3）

1. **组件测试与 E2E**：@vue/test-utils 覆盖 FieldAiButton/TokenBadge/三件套插入流程；Playwright E2E 跑「导入→编辑→导出」金路径。
2. **CI（GitHub Actions）**：push 触发 typecheck + vitest + build；release 分支打 Tauri 包。
3. **i18n 骨架**：vue-i18n 接入，zh-CN 文案表先行，en-US 预留。
4. **大规模卡库性能**：>500 张时列表虚拟滚动（NVirtualList）；`listCards` 分页游标（SQLite LIMIT/OFFSET 下推驱动层）。

## 五、迭代三/四审查遗留（低优先级技术债）

- **reqwest Client 逐请求新建**（http.rs/llm.rs）：无连接池复用，同渠道连续对话重复 TLS 握手；改 `OnceLock<Client>` 共享。
- **流式逐 chunk base64 + JSON IPC 开销**：SSE 小块 +33% 膨胀，长文数千块形成可感知开销；可攒批（N ms 合并）或迁 Tauri 原始二进制通道。
- **数据库降级提示仅设置页可见**：`consumeDegradedNotice` 在 SettingsView 消费；应升级为 App 级一次性全局提示。
- **`verifyFontFile` 全量读文件**仅为验证可读性（几十 MB 入内存）：Rust 侧加 `font_exists`（try_exists + 元数据）更优。
- **tauriStream.ts / appearance store init 分步容错 / pickFiles 兜底** 无单测：可 mock `window.__TAURI__` 覆盖（error 先于 headers、cancel 触发、signal 桥接）；happy-dom 可模拟 focus/visibilitychange。
- **流式超时重试的 onDelta 重放语义**：已产出内容后空闲超时已置不可重试，但若未来放开需定义 reset 语义（按 delta 累积的调用方会内容翻倍）。
- **`getStore` initStore 拒绝后永久缓存 rejected promise**：initStore 失败时应清空 `storePromise` 允许重试（当前 Tauri 失败重试一次后必落到可用驱动，实际不触发）。

## 六、历史规划归档说明

早期规划文档（原 `plans/TavernCard_Studio.md` 项目规划 M1-M3、`plans/Optimization_Roadmap.md` P0 优化、`plans/Iteration3_MultiChar_EditorUX_Plan.md` 多人卡与编辑器 UX 迭代）中的内容**均已实现**，规划细节已并入 [ARCHITECTURE.md](./ARCHITECTURE.md) 的实际实现描述，未完成项保留在本文档。参考蓝本：piney（工作站形态）、sillytavern-Novalcard（小说→成卡流水线）。
