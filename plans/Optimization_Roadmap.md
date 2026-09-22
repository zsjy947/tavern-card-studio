# TavernCard Studio 总体优化文档

> 基于 v0.1.0（master `2423f9e`）的实现现状，在原规划（M1-M3）之外提出的**功能增强**与**工程优化**设计。
> 本文档是 dev 分支的开发依据；按优先级分四批，P0 已在 dev 分支实现。

## 0. 现状盘点（优化出发点）

已落地：M1 全部 + M2 大部（转换/卡库/编辑器六 Tab/版本/向导/美化三件套/模板中心/AI 中心/诊断静态部分/工坊骨架/统计/备份）+ 83 单测。

主要缺口与痛点：

| # | 痛点 | 影响 |
|---|---|---|
| A | 工坊「一键抽取」是一步大调用，失败重跑成本高 | 长流程脆弱 |
| B | 编辑器没有撤销栈，误改只能靠版本回滚 | 体验粗糙 |
| C | 卡库无分类目录，规划里的 categories 表建了但没接 UI | 组织能力缺失 |
| D | AI 渠道没有并发限制与全局系统提示词（规划 4.5 明确要求） | 稳定性/个性化缺失 |
| E | 无键盘快捷键、无命令面板 | 高频操作慢 |
| F | 导入导出全是「下载到下载目录」，没有工作区文件夹概念 | 文件散落 |
| G | 5.6MB 的 tiktoken chunk 拖慢首屏 | 启动性能 |
| H | 转换器整卡导入才建库，临时转换不落痕迹；无「最近转换」 | 复查困难 |
| I | 卡片对比只能版本↔当前，不能任意两卡横向对比 | 二创场景常用 |
| J | 无导入预设（ST 导入选项：世界书拆全局/内嵌保留） | 兼容性 |

## P0（dev 分支首批实现）

### 1. 卡片分类目录（补 C）
- 数据：`categories(id, name, sort)` 表已定义；`cards.categoryId` 字段已有。
- UI：卡库左侧分类树（全部/未分类/自定义分类），拖拽卡片入分类（`updateCardPatch`）。
- 交互约束：删除分类时卡片回落"未分类"，不删卡。

### 2. 编辑器本地撤销/重做（补 B）
- 实现 `useCardHistory` 组合式：深拷贝快照栈（上限 50），Ctrl+Z / Ctrl+Shift+Z。
- 快照节流：输入停顿 500ms 才入栈，避免每键一帧。
- 与版本快照的关系：本地撤销只作用于未保存的编辑态；保存后清空撤销栈（版本历史接管回滚）。

### 3. 全局命令面板（补 E）
- Ctrl+K 唤起，naive-ui modal + 模糊搜索。
- 命令源：路由跳转（11 页面）、卡库最近 10 张卡直达编辑、新建卡、导入、切换主题。
- 架构：`src/composables/useCommandPalette.ts` 注册表模式，视图只注册命令不实现面板。

### 4. AI 并发限制 + 全局系统提示词（补 D，规划 4.5 原文要求）
- `aiService` 增加信号量队列（并发上限默认 2，渠道级可配）。
- 渠道增加 `globalSystemPrompt` 字段：所有请求自动前插一条 system 消息（用户级个性化，如文风偏好）。
- 重试对齐：429 触发的排队优先于重试。

### 5. 任意两卡横向对比（补 I）
- 新路由 `/compare?a=&b=`：字段级 diff（复用 `diffCards`）+ 并排文本预览。
- 入口：卡库多选后「对比」按钮（2 张时可用）。

## P1（后续批次）

### 6. 工坊流水线细粒度断点（补 A）
- 把「一键抽取」拆为 extract → worldbook 两个可独立重跑的步骤，产物分别落 `pipelineState`（新增 `extractedBase` 与 `worldbookEntries` 两个键），失败只重跑当前步。
- 每步完成度落 `stage`，UI 显示步骤级 ✓/↻。

### 7. 工作区文件夹（补 F）
- 设置中指定「导出目录」默认值；Tauri 模式经 dialog 插件选目录 + fs 插件直接写文件（浏览器模式维持下载）。
- 导出文件命名规则可配置（`{name}`/`{spec}`/`{date}` 占位）。

### 8. tiktoken 按需加载（补 G）
- `stats/tokens` 改为惰性单例：首次调用时动态 import，加载完成前 `countTokens` 返回粗估值并标记 `estimated: true`。
- 卡片列表封面 token 徽章延迟到编码器就绪后刷新。

### 9. 转换器「最近转换」记录（补 H）
- 转换结果（文件名/卡名/规格/错误）落 settings 表 `recent_conversions`（上限 50）。
- 报告面板增加「重新下载」入口（保存产物 bytes 的 dataURL，>2MB 不留）。

### 10. 导入预设选项（补 J）
- 导入时可选：世界书保持内嵌 / 拆为 ST 全局世界书（生成独立 JSON 同名下载）；正则脚本随卡 / 导出为独立脚本 JSON。
- 预设可保存复用（settings）。

## P2（体验深化）

### 11. 卡片市场式预览
- 卡库卡片双击进入只读预览页（封面 + 开场白渲染 + 世界书条目折叠列表 + token 概览），「编辑」按钮进入编辑器。降低误入编辑器的心智成本。

### 12. 状态栏模板「元素点选定向改」
- 美化工作台预览 iframe 注入 postMessage 桥：点击预览元素回传 CSS 选择器，右侧高亮对应 CSS 规则块（CodeMirror 行高亮），改完实时重渲。规划 4.3「AI 美化工作台·点击选中元素定向修改」的本地版前置。

### 13. AI 美化三件套生成
- 提示词库新增 `beautify:trio`：输入卡简介 + 风格关键词 → 输出 `{html, css, js, variables[], worldinfoEntry}` JSON → 直接进预览。
- 产物作为用户模板入库（可复用）。

### 14. 快捷键体系
- 全局：Ctrl+K 面板、Ctrl+S 保存（编辑器）、Ctrl+Z/Y 撤销、F2 重命名卡。
- 表格式注册（命令面板复用）。

## P3（工程与远期）

### 15. 组件测试与 E2E
- @vue/test-utils 覆盖 FieldAiButton/TokenBadge/三件套插入流程；Playwright E2E 跑「导入→编辑→导出」金路径（对齐 M1 验收标准自动化）。

### 16. CI（GitHub Actions）
- push 触发：typecheck + vitest + build；release 分支打 Tauri 包（需自托管 Rust runner 或容器）。

### 17. i18n 骨架
- vue-i18n 接入，文案表 zh-CN 先行；为 en-US 预留。

### 18. 大规模卡库性能
- 卡 >500 张时列表虚拟滚动（NVirtualList）；`listCards` 分页游标（SQLite LIMIT/OFFSET 下推到驱动层）。

## dev 分支实现范围（本批）

P0 全部 5 项 + 单元测试 + 冒烟验证：

| 项 | 新增/改动文件 | 测试 |
|---|---|---|
| 分类目录 | LibraryView 分类树、cardService.assignCategory | 服务层用例 |
| 撤销栈 | composables/useCardHistory.ts + EditorView 接线 | 快照/节流/上限用例 |
| 命令面板 | composables/useCommandPalette.ts + CommandPalette.vue | 注册/过滤用例 |
| AI 并发+系统提示 | aiService 信号量 + channel 字段 | 并发顺序/前插用例 |
| 两卡对比 | CompareView.vue + 路由 + diffCards 复用 | diffCards 扩展用例 |

不在本批：P1-P3（按上文排期）。
