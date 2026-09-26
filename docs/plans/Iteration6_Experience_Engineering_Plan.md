# 迭代六规划：ROADMAP 清尾（功能收尾 · 体验深化 · 工程化 · 技术债）

> 状态：**规划中，未实施**。覆盖 [ROADMAP.md](../ROADMAP.md) 剩余 15 项（P1×4、P2×3、P3×4、技术债×7）+ 迭代五联动验收 2 项。
> 前置关系：与 [Iteration5_MVU_Worldbook_Statusbar_Plan.md](./Iteration5_MVU_Worldbook_Statusbar_Plan.md) 无代码耦合，可并行或接续实施；批次 E 依赖迭代五产物。
> 撰写日期：2026-09-27。基线确认：`package.json` 已有 `typecheck`（vue-tsc --noEmit）脚本；`@vueuse/core` 未安装。

---

## 0. 参考来源（本次检索确认）

| 主题 | 参考 |
|---|---|
| Tauri v2 E2E（官方路线） | [Tauri v2 Selenium/WebDriver 指南](https://v2.tauri.app/develop/selenium/)（tauri-driver）、[wdio-tauri-service](https://webdriver.io/docs/wdio-tauri-service/)（WebdriverIO 官方 Tauri 服务） |
| Tauri v2 E2E（推荐路线） | Playwright 官方 WebView2 集成：`chromium.connectOverCDP` + 启动环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`；社区警告：Playwright 自带 Chromium ≠ 真实 WebView2 引擎（本项目连的就是真实实例，不受影响） |
| CI 打包发布 | [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)（官方 Action，v0 支持 Tauri v2，tag 触发 + 草稿 release）；[swatinem/rust-cache](https://github.com/Swatinem/rust-cache) |
| tiktoken 惰性加载 | [js-tiktoken（npm）](https://www.npmjs.com/package/js-tiktoken)：`import { Tiktoken } from "js-tiktoken/lite"` + 按需 `import("js-tiktoken/ranks/cl100k_base")`，官方明示「只加载需要的 ranks 可显著减小 bundle」（已装 ^1.0.21 支持） |
| 流式二进制 IPC | Tauri v2 `Channel<InvokeResponseBody>` 发 `InvokeResponseBody::Raw(Vec<u8>)`（tauri ≥ 2.10 实现 `IpcResponse`，前端收 ArrayBuffer）；机制说明见 [connectrpc-tauri](https://github.com/mathematic-inc/connectrpc-tauri/blob/main/README.md)、实践见 [Bancada scope-architecture](https://github.com/kayaman/bancada/blob/main/docs/scope-architecture.md)；已知 caveat：raw 二进制通道仅部分平台支持——本项目仅桌面打包，不涉及 |
| CSS 选择器生成 | [@medv/finder](https://github.com/antonmedv/finder)（零依赖 ~2KB，生成最短唯一选择器，Playwright/Puppeteer 生态广泛使用） |
| MVU 生态（迭代五联动） | [MagicalAstrogy/MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate)、[酒馆助手 JS-Slash-Runner 文档](https://n0vi028.github.io/JS-Slash-Runner-Doc/)、StageDog/tavern_resource（mvu_zod.js 上游） |

## 1. 实施原则与总体顺序

**护栏先行**：CI 是其余 17 项改动的回归兜底，最先落地；与 CI 同期做三个「快赢」技术债（D1/D2.1/D7，改动小收益直接）；随后 P1 → P2 → P3 推进，最重的 B2（点选定向改）放体验批次末尾。

```
C1 CI 护栏 ──→ D1/D2.1/D7 快赢技术债 ──→ A 批 P1 功能收尾（4 项，小而快）
──→ B 批 P2 体验（B3 快捷键 → B1 预览 → B2 点选定向改）
──→ C2 组件测试+E2E ──→ C3 i18n ──→ C4 大规模卡库
D2.2 / D3 / D4 / D5 / D6 穿插；E 批随迭代五实施节奏
```

---

## 2. 批次 A：P1 功能收尾（4 项）

### A1 导出文件名模板（ROADMAP P1-2）

- **动机**：导出目录已可配置，命名规则固定不可配。
- **方案**：settings 增 `export_filename_template`，默认 `{name}_{date}`；占位符 `{name}/{spec}/{version}/{date}`。核心纯函数 `renderExportFilename(template, ctx)` 独立成可单测模块（空 `{name}` 回退 `untitled`、超长截断；Windows 非法字符兜底仍由 Rust `safe_export_file_name` 二次清洗，前端不重复造黑名单）；SettingsView 导出设置区加模板输入 + 实时预览示例；`exportService.saveExportFile` 改用渲染结果。
- **落点**：`src/core/card/exportName.ts`（新）、`src/services/exportService.ts`、`src/views/SettingsView.vue`。
- **验收**：单测覆盖占位符组合/空名/非法字符；导出产物名符合模板；模板清空回退默认。

### A2 tiktoken 按需加载（ROADMAP P1-3）

- **动机**：cl100k ranks（约 5.6MB）静态 import 拖慢首屏。
- **方案**：改用 `js-tiktoken/lite` 的 `Tiktoken` 类，ranks 经动态 `import("js-tiktoken/ranks/cl100k_base")` 独立成 chunk，模块级 promise 单例 `getEncoder()`；就绪前走既有 CJK 粗估并返回 `estimated: true`，`TokenBadge` 与卡列表徽章显示 `~` 前缀、就绪后无感替换为精确值（不阻塞渲染，列表延迟刷新）。
- **落点**：`src/core/stats/tokens.ts`、`src/components/TokenBadge.vue`。
- **验收**：构建产物中 ranks 为独立 chunk 且不被首屏引用；未就绪路径单测；诊断页 token 报告标注「估算/精确」来源。

### A3 转换器「最近转换」记录（ROADMAP P1-4）

- **动机**：转换是一次性操作，历史不可回溯。
- **方案**：settings 键 `recent_conversions`：`{ id, fileName, spec, sizeBytes, savedAt, exportedPath? }`，上限 50 淘汰最老；**>2MB 只记元数据不留产物**（对齐 ROADMAP 原约束）；ConverterView 成功转换后写入，报告面板新增「最近转换」列表 + 「重新下载」（内存无产物的大文件条目禁用并注明原因）。
- **落点**：`src/services/appSettings.ts`、`src/views/ConverterView.vue`。
- **验收**：单测上限淘汰与 2MB 阈值；桌面/浏览器两驱动下 settings 读写等价。

### A4 导入预设选项（ROADMAP P1-5）

- **动机**：导入行为单一（全内嵌），社区玩家常需要「世界书拆全局、正则拆独立脚本」的酒馆侧用法。
- **方案**：导入入口（卡库工具栏 + 拖放）弹导入选项：世界书「保持内嵌（默认）/ 拆为 ST 全局世界书 JSON（落导出目录）」、正则「随卡（默认）/ 导出独立脚本 JSON（ST 脚本库数组格式）」；选项组合可保存为预设（settings `import_presets`，上限 10，命名复用）；世界书拆分复用 `characterBookToWorldInfo`（ST 专属字段已在 extensions 双向保留，拆分不丢数据）；新增 `regexScripts → ST 脚本库 JSON` 导出纯函数。
- **落点**：`src/services/cardService.ts`（导入编排参数化，**默认行为不变**）、新组件 `ImportOptionsModal.vue`、`src/core/regex/export.ts`（新）。
- **验收**：拆分导入后卡内无 `character_book`/`regex_scripts` 且导出目录出现对应 JSON；**默认「保持原样」时 13 张真实社区卡导入回归全部通过**；预设保存/复用/删除闭环。

---

## 3. 批次 B：P2 体验深化（3 项）

### B1 卡片市场式预览（ROADMAP P2-1）

- **方案**：新路由 `/preview/:id`（第 13 条路由）；LibraryView **单击保持选中、双击进预览**；预览页只读：封面大图、基础信息、`first_mes`/`alternate_greetings` 渲染（`{{user}}/{{char}}` 宏替换 + `<StatusPlaceHolder*>` 等美化占位符以徽标形式提示「渲染占位符，酒馆内生效」）、世界书折叠列表（蓝/绿灯徽标 + content 折叠）、正则/脚本清单、token 概览（复用 TokenBadge）；右上「编辑」进编辑器；命令面板登记入口。
- **落点**：`src/views/PreviewView.vue`（新）、`src/router/index.ts`、`src/views/LibraryView.vue`。
- **验收**：双击进预览且页面无任何写入口；含 300 条世界书的大卡折叠展开不卡（必要时叠加 C4 行虚拟化）；返回卡库保留滚动位置与选中态。

### B2 状态栏「元素点选定向改」（ROADMAP P2-2，本批最重）

- **方案**：
  - **iframe 内 picker**：`HtmlPreview` 增加 `enablePicker` 模式，srcdoc 注入 picker 脚本（模板字符串常量）：进入点选态后 `mouseover` 加 outline 高亮（临时样式标记，不污染模板 CSS）、`click` 阻止默认与冒泡，用 **`@medv/finder`** 生成最短唯一 CSS 选择器，`postMessage` 回父页 `{ type: 'tcs-pick', selector }`；Esc 退出点选态（sandbox 已含 allow-scripts/allow-same-origin，postMessage 可用）。
  - **父页定位**：新核心模块 `src/core/css/locate.ts` 纯函数——扫描 CSS 文本解析 `selector{...}` 规则块区间，selector 归一化匹配；`finder` 产出的 nth-of-type/结构化选择器若无法反查到规则块（样式来自类组合等），降级为「在 style 末尾追加覆盖规则」建议而非报错。
  - **编辑联动**：命中后 CodeMirror 滚动至该规则块并背景高亮，修改防抖 500ms 重渲 iframe；变量改名重写器行为不受影响（只读定位，不改写逻辑）。
- **参考**：`@medv/finder`（§0）；交互范式对标 Chrome DevTools 元素选择器。
- **落点**：`src/core/css/locate.ts` + 单测（新）、`src/core/css/pickerScript.ts`（新）、`src/components/HtmlPreview.vue`、`src/views/BeautifyView.vue`。
- **验收**：六维雷达模板点选任一属性条 → 右侧高亮并定位到对应规则；嵌套/重复 class 场景选择器生成单测；无对应规则时给出追加建议；退出点选态后预览交互恢复正常。

### B3 快捷键体系（ROADMAP P2-4）

- **方案**：新 `src/composables/useShortcuts.ts`：表格式注册 `{ combo, scope: 'global'|'library'|'editor'|..., handler, description }`，全局单例 registry；LayoutView 挂统一 keydown 捕获层（`input/textarea/contenteditable` 聚焦时不触发非 global 组合）；设置页新增「快捷键」只读表（数据即注册表，与命令面板同源描述）；落地按键：**F2 重命名卡**、Delete 删除卡（走既有确认框）、↑↓ 卡列表导航、Enter 进预览（依赖 B1）；同 scope 冲突注册 console.warn。
- **说明**：自解析 combo 串（`Ctrl+Shift+X` 语法），不引入 vueuse——注册表复用自家 `useCommandPalette` 模式即可。
- **落点**：`src/composables/useShortcuts.ts`（新）、`src/views/LayoutView.vue`、`src/views/LibraryView.vue`、`src/views/SettingsView.vue`。
- **验收**：设置页表格完整列出注册项；F2/Delete 生效且输入框聚焦时不误触；Ctrl+K/Ctrl+S/撤销重做既有行为不回归。

---

## 4. 批次 C：P3 工程与远期（4 项）

### C1 CI（ROADMAP P3-2）——**最先实施（护栏原则）**

- **方案**：
  - `.github/workflows/ci.yml`（push/PR）：setup-node 20（cache: npm）→ `npm ci` → `npm run typecheck`（脚本已存在）→ `vitest run` → `vite build`；独立 job `cargo test`（`dtolnay/rust-toolchain` + `swatinem/rust-cache`，按 `src-tauri/**` paths 过滤触发）。
  - `.github/workflows/release.yml`（tag `v*`）：windows-latest → tauri-action@v0（`tagName: v__VERSION__`、`releaseName: 'v__VERSION__'`、`releaseDraft: true`，`GITHUB_TOKEN` 权限 contents: write）→ 追加一步运行 `scripts/collect-release.mjs` 收集 portable exe 与 NSIS 包为 workflow artifact（不自动发正式 release，人工检查草稿）。
- **落点**：`.github/workflows/ci.yml`、`.github/workflows/release.yml`（均新）。
- **验收**：PR 上 CI 全绿；打 tag 产出草稿 release 与 artifact；ci 时长 < 15min（缓存生效）。

### C2 组件测试与 E2E（ROADMAP P3-1）

- **方案**：
  - **组件测试**：devDeps 新增 `@vue/test-utils` + `happy-dom`；用例：FieldAiButton（生成/优化/翻译三模式的回调参数与禁用态）、TokenBadge（estimated 标记，衔接 A2）、beautifyService 三件套插入流程（MemoryStore 全链路 + 幂等断言）。
  - **E2E 推荐路线——Playwright connectOverCDP 直连真实 WebView2**：本项目仅打包 Windows（NSIS），WebView2 就是唯一真实引擎，规避「Playwright 自带 Chromium 给假信心」的社区警告；`scripts/e2e-dev.mjs` 以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 dev 构建，测试内 `chromium.connectOverCDP("http://127.0.0.1:9222")` 附加。金路径用例：启动 → 导入 `tests/fixtures` 真实卡 → 改一个字段 → 保存 → 导出 PNG → 用自家 `core/png/codec` 读回断言。LLM 相关全 mock/跳过，E2E 不依赖 API key。
  - **备选路线**：官方 `tauri-driver`（WebDriver）+ WebdriverIO（或 wdio-tauri-service）——若 connectOverCDP 在 CI 无头环境不稳则切换。
- **落点**：`tests/e2e/*.spec.ts`、`playwright.config.ts`、`scripts/e2e-dev.mjs`、`package.json` scripts（`e2e`）。
- **验收**：本机 `npm run e2e` 金路径通过；CI（windows runner 自带 WebView2 runtime）标记 continue-on-error 起步；现有 141 vitest 用例不回归。

### C3 i18n 骨架（ROADMAP P3-3）

- **方案**：vue-i18n@10 composition 模式；`src/locales/zh-CN.json` 先行、`en-US.json` 预留；**locale 懒加载**（`createI18n` 空表 + 切语言时动态 `import(./locales/${lang}.json)`，vite 分 chunk）；首期抽取范围克制：Layout / 命令面板 / 通用组件（FieldAiButton、TokenBadge、全局确认框）/ 设置页，视图深层文案**渐进迁移**（避免一次性抽取失控）；naive-ui `NConfigProvider` 的 `locale/dateLocale` 跟随切换；settings 存 `ui_language`。
- **落点**：`src/i18n/index.ts`（新）、`src/locales/*`、`App.vue`/`LayoutView.vue`、`SettingsView.vue`。
- **验收**：切换语言通用层即时生效且持久化；默认 zh-CN 零回归；locale chunk 不进首屏 bundle。

### C4 大规模卡库性能（ROADMAP P3-4）

- **方案**：
  - **虚拟滚动**：卡网格按「行虚拟化」——行高固定、每行 4-6 卡，仅渲染可视窗口 ± buffer。选型：新增依赖 `@vueuse/core` 的 `useVirtualList`（tree-shakeable）或用 naive-ui `NVirtualList` 作行容器，**推荐前者**（自绘行容器少受组件库限制）；**浏览器模式降级为普通滚动**（规避已知事项：内嵌受限浏览器 NVirtualList 可能不渲染），桌面优先。
  - **分页游标**：`DataStore` 接口增 `listPage(table, { cursor, limit })`：SQLite `WHERE id > ? ORDER BY id LIMIT ?`（keyset 分页，游标=末位 id）、IndexedDB 用 IDBCursor、Memory 全量切片；`cardService.listCardsPaged` 返回 `{ rows, nextCursor }`；阈值常量 `VIRTUAL_SCROLL_THRESHOLD = 500`，超过自动启用；搜索先在已载入轻量行（id/name/封面指纹）内过滤，详情懒加载。**导入/去重路径仍全量**，分页只作用于列表展示。
  - 佐证工具：`scripts/gen-fixture-cards.mjs` 合成 600 张卡。
- **落点**：`src/db/store.ts`、`src/db/{tauri,indexeddb,drivers}.ts`、`src/services/cardService.ts`、`src/views/LibraryView.vue`、`scripts/gen-fixture-cards.mjs`（新）。
- **验收**：两驱动 `listPage` 等价性单测；600 张合成卡滚动与筛选可用；<500 张路径行为不变（现有测试兜底）。

---

## 5. 批次 D：技术债（7 项）

### D1 reqwest Client 逐请求新建 → 共享连接池

- **方案**：`src-tauri/src/commands/http.rs` 定义 `static SHARED_CLIENT: OnceLock<reqwest::Client>`（builder 预设 connect_timeout 15s），http.rs 与 llm.rs 共用；llm 现有的四级超时为请求级 `.timeout()`，与共享连接池不冲突。
- **落点**：`src-tauri/src/commands/{http,llm}.rs`。
- **验收**：cargo test 全绿；同渠道连续对话复用连接（pool 行为评审确认）。

### D2 流式逐 chunk base64 + JSON IPC 膨胀（分两步）

- **D2.1 攒批（短平快）**：llm.rs 以 ~16ms 时间窗聚合上游 bytes 后合并发一条 `Chunk{bytes_b64}`（我们传的是原始字节流，拼接无损，前端 `ReadableStream` 语义不变）；改动 ~30 行，先消掉最大头发包开销，可独立回退。
- **D2.2 原始二进制通道（结构性）**：迁 `Channel<InvokeResponseBody>` 发 `InvokeResponseBody::Raw(bytes)`（tauri ≥ 2.10，前端收 ArrayBuffer，彻底移除 base64 +33% 膨胀）；StreamEvent 契约调整为 JSON 控制消息（headers/done/error）+ Raw 二进制帧混排，`tauriStream.ts` 适配；serde 契约锚点测试同步更新。已知平台 caveat（raw 通道移动端差异）不涉及本项目（仅桌面打包）。
- **落点**：`src-tauri/src/commands/llm.rs`、`src/core/llm/tauriStream.ts`。
- **验收**：mock 流测试不回归；10K token 长回复的 IPC 帧数/内存峰值前后对比记录进 PR。

### D3 数据库降级提示全局化

- **方案**：`consumeDegradedNotice` 消费点从 SettingsView 上移到 LayoutView 挂载时，以 `NNotification` 全局一次性提示「已降级为浏览器存储 + 原因」，设置页保留静态详情。
- **验收**：驱动 mock 模拟 SQLite 初始化失败 → 通知出现且仅一次。

### D4 `verifyFontFile` 全量读文件 → 轻量存在性检查

- **方案**：Rust 新命令 `font_exists(dir, name) -> Result<Option<u64>, String>`（`tokio::fs::try_exists` + `metadata().len()`），fontService 导入/删除前用其校验并预判大小上限；全量 `font_read` 仅在真正需要内容时发生。
- **落点**：`src-tauri/src/commands/fonts.rs`、`src/services/fontService.ts`（capabilities 无需改动——自定义命令不受 fs 插件权限约束）。
- **验收**：cargo test 文件名/路径校验用例扩展；字体导入流程行为不变。

### D5 tauriStream / appearance init / pickFiles 补单测

- **方案**：happy-dom + mock `window.__TAURI__`：tauriStream（error 先于 headers、done 正常收束、cancel 触发 `llm_cancel_stream`、AbortSignal 桥接）；appearance store init 分步容错（localStorage 脏数据不致命）；pickFiles 无 Tauri 环境兜底路径。
- **落点**：`src/core/llm/tauriStream.test.ts`、`src/stores/appearance.test.ts`、`src/utils/file.test.ts`。
- **验收**：新增 ≥10 用例，三文件进入覆盖报告。

### D6 流式超时 onDelta 重放语义（以结论关闭）

- **方案**：维持「已产出内容后空闲超时不可重试」的现状决策，在 `client.ts` 对应分支注释固化 ADR 短结论（若未来放开：重试必须由调用方携带已累积 delta 做 reset，否则按 delta 累积的调用方会内容翻倍）；本项不写功能代码，ROADMAP 条目移除并注明结论位置。

### D7 `getStore` rejected promise 永久缓存

- **方案**：`db/index.ts` initStore 失败路径清空模块级 `storePromise` 再降级/抛出，允许后续调用重试；补单测：mock 首次初始化抛错、第二次成功 → getStore 第二次返回可用驱动。
- **验收**：单测覆盖；SQLite→IndexedDB→Memory 降级链不回归。

---

## 6. 批次 E：迭代五联动验收（2 项）

### E1 MVU 真机验收清单（迭代五 D 批的收尾条件）

- **方案**：验收清单落 ROADMAP 已知事项：① 酒馆端装齐 [酒馆助手 JS-Slash-Runner](https://n0vi028.github.io/JS-Slash-Runner-Doc/)（渲染器开启、代码折叠=仅前端）+ 提示词模板 + [MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate) 库；② 导入迭代五产物卡新建聊天，断言：initvar 变量初始化生效、AI 回复含 `<UpdateVariable>` 块且被两段美化正则正确折叠/展开、状态栏占位符渲染、长对话下「只发最新 N 楼」裁剪生效、Zod clamp/prefault 生效（喂越界值观察）；③ 记录 MVU/酒馆助手版本号备查。
- **性质**：人工验收，不做自动化。

### E2 MVU 三方路径校验（承接迭代五 E4 若后置）

- **方案**：扫描状态栏 HTML/JS 中 `stat_data.` 路径字面量（含 `_.get(...)` 调用点）vs `tcsMvuVarGroups` 定义树，输出双向漂移清单（HTML 用了未定义路径 / 定义了未使用路径）；入口放编辑器「变量」Tab 与美化工作台。
- **验收**：构造漂移样本单测；零漂移时显示通过态。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| WebView2 E2E 在 CI 无头环境不稳（调试端口生命周期、runner 差异） | 备选退回官方 tauri-driver + WebdriverIO 路线；E2E 在 CI 标记 `continue-on-error` 起步，本机为准入门槛 |
| i18n 抽取工作量失控 | 骨架期只抽通用层并写明「渐进迁移」边界；en-US 允许 10% 覆盖 |
| 虚拟滚动与已知事项冲突（内嵌浏览器 NVirtualList 不渲染） | 桌面优先，浏览器模式降级普通滚动；选型倾向 @vueuse/useVirtualList（自绘行容器，少受组件库限制） |
| `InvokeResponseBody::Raw` 与现有 StreamEvent 消费方的契约破坏 | serde 契约锚点测试先行改造；D2.1 攒批方案作为独立可回退的第一步 |
| 分页游标与导入去重/批量写的交互 | 明确分页只管展示路径，导入仍全量读 + dataHash 去重，接口层隔离 |
| 快捷键与既有 Ctrl+K/S/Z 冲突 | 统一 registry 集中管理，冲突注册时 warn 并在设置页可见 |
| 新增依赖（@vueuse/core、@medv/finder、@vue/test-utils、happy-dom、vue-i18n、playwright）体积与维护 | 全部为 devDeps 或 tree-shakeable 小库；finder 仅 ~2KB；playwright 仅 devDeps 不进产物 |

## 8. 与 ROADMAP / ARCHITECTURE 的流转

- 实施完成后按条勾销 ROADMAP §二/三/四/五；§一已知事项增补 E1 清单与「浏览器模式虚拟滚动降级」新边界。
- ARCHITECTURE.md 增补：快捷键注册表、i18n 骨架、E2E 路线、`listPage` 存储接口、共享 reqwest Client、流式二进制契约。
- 本文档随实施完成按 623b6c2 惯例归档（已实现内容并入 ARCHITECTURE，未完成项留 ROADMAP）。
