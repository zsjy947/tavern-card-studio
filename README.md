# TavernCard Studio · 酒馆角色卡工作站

本地桌面端 **SillyTavern 角色卡工作站**：转换、编辑、模板美化、AI 辅助生成、诊断修复、同人卡工坊。

- **格式与酒馆完全兼容**：PNG 读取优先 `ccv3` 回退 `chara`（对齐 ST `character-card-parser.js`）；导出默认双写 `ccv3 + chara`；世界书互转对齐 ST `convertCharacterBook`，ST 专属字段（递归/概率/深度/分组）存于条目 `extensions` 不丢失。
- **数据全在本地**：Tauri 桌面模式 SQLite（便携 `./data`，失败回退 AppData）；浏览器模式 IndexedDB。API Key 不出本机，无遥测。
- **业务 99% TypeScript**：Rust 只做壳（注册插件/数据目录），核心逻辑全部在 `src/core/` 纯 TS 领域库，可单测。

## 快速开始

```bash
npm install
npm run dev        # 浏览器模式（IndexedDB 兜底存储）
npm test           # vitest：111 个用例（PNG 编解码/迁移矩阵/世界书互转/LLM mock/epub/服务层集成/社区卡宽容导入）
npm run typecheck  # vue-tsc
npm run build      # 生产构建
```

### 打包桌面版（需要 Rust 工具链）

```bash
npm install -D @tauri-apps/cli   # 如未安装
npx tauri icon src-tauri/icons/icon.png   # 生成各尺寸图标
npx tauri build                  # 产出 NSIS 安装器（x64）
```

Tauri 壳已配置：`withGlobalTauri` + `plugin:sql`（SQLite）+ dialog/fs 插件、便携模式数据目录逻辑（`src-tauri/src/lib.rs`）。前端通过 `window.__TAURI__.core.invoke` 调用 SQL 插件（`src/db/tauri.ts`），web 构建保持零 Tauri 依赖。

## 功能地图

| 模块 | 能力 |
|---|---|
| 卡库 | 搜索/标签筛选/回收站（软删除）/批量导出 zip/导入去重 |
| 编辑器 | 六 Tab：基础信息 / 描述与开场白（HTML 预览）/ 世界书（ST 互导）/ 正则（简化+高级、实时测试）/ 脚本（CodeMirror JS）/ 扩展（depth_prompt、原始 JSON）；每字段 token 统计 + AI 生成/优化/翻译 |
| 转换工具 | PNG⇄JSON 批量互转、完整性校验报告、双写开关 |
| 生成向导 | 选模板（5 套：全档/事件/精简/NPC/空白）→ 一句话设定扩写 → 分步生成整卡，每步确认 |
| 美化工作台 | 状态栏模板（4 套：数值栏/六维雷达/立绘卡面/手机 UI）变量配置 + iframe 沙箱实时预览 + **三件套一键插入**（占位符+正则+世界书规则条目），图片走外链不膨胀体积 |
| 模板中心 | 四类模板管理、从当前卡沉淀模板、导入导出 JSON |
| AI 中心 | 多渠道（文本/生图分开，OpenAI 兼容 + NovelAI）、测连、拉模型、用量记录 |
| 诊断与调整 | 静态检查（秒出：schema/token/键冲突/正则语法/嵌图体积）+ 卡医 LLM 诊断（维度评分+处方）→ diff 预览 → 应用 |
| 同人卡工坊 | txt/epub 导入 → 章节切分 → 角色扫描（边缀折叠词频）→ 上下文检索（等距采样）→ 抽卡+世界书六类 → 文风蒸馏 → 开场白 → user 人设；项目化保存断点续跑 |
| 版本管理 | 保存自动快照（上限 50）、版本列表、两版 diff、回滚 |
| 统计看板 | 卡数/模板/体积/token 分布/AI 调用趋势与功能排行 |
| 设置与备份 | 全量备份导出/导入 zip（合并或清空恢复）、运行环境说明、PNG 双写等偏好 |
| 使用指南 | 面向新手：每个字段/选项的作用 + 它会以什么方式注入 SillyTavern（字段速查/世界书/正则/脚本/常见问题） |

## 工程结构

```
├── src/
│   ├── core/       # 纯 TS 领域库（无 UI 依赖，vitest 覆盖）
│   │   ├── card/   # V1/V2/V3 schema(zod)、归一化迁移、内容指纹
│   │   ├── png/    # tEXt chunk 编解码（手写，零依赖）
│   │   ├── lorebook/ # 内嵌世界书 ⇄ ST 全局世界书
│   │   ├── regex/  # ST 正则脚本模型 + 应用引擎
│   │   ├── script/ # 酒馆助手脚本 / QuickReply
│   │   ├── template/ # {{user}}/{{char}}/变量引擎
│   │   ├── stats/  # cl100k token 分类统计
│   │   ├── llm/    # OpenAI 兼容客户端（SSE/重试/续写/JSON 抽取）+ 生图
│   │   ├── novel/  # txt/epub 解析、章节、角色扫描、上下文采样
│   │   └── diag/   # 静态检查
│   ├── db/         # 存储抽象：Memory / IndexedDB / Tauri SQLite
│   ├── services/   # 业务服务（卡片/模板/AI/美化/诊断/工坊/备份/偏好）
│   ├── builtins/   # 内置模板资产（首启播种到库，可复制修改）
│   ├── stores/     # Pinia（workspace）
│   ├── components/ # TokenBadge / FieldAiButton / HtmlPreview / CodeEditor / CardCover
│   └── views/      # 12 个页面（含使用指南）+ editor 六 Tab
├── src-tauri/      # Tauri 2 壳（NSIS、便携模式）
├── tests/          # 服务层集成测试
└── plans/          # 设计规划与优化文档
```

## 设计决策速览

1. **宽容读取、规范写出**：解析社区卡时未知字段 passthrough 保留；导出补齐顶层冗余字段（旧前端只读顶层）。
2. **整对象存储**：所有表以 `{id, json}` 形态存储（SQLite JSON 列 / IndexedDB object store），本地规模下免去 ORM，双驱动行为一致、测试可用 MemoryStore。
3. **响应式消毒**：服务层入口对 Vue Proxy 做 JSON 往返（IndexedDB 结构化克隆不支持 Proxy）。
4. **token 统计防巨串**：超 8K 字符片段走粗估，避免 BPE 对 base64 嵌图的二次方级耗时。
5. **图片外链化**：本地路径自动转 `file://`，base64 内嵌给出警告（体积策略见需求 #6）。

## 已知事项

- 内嵌受限浏览器中 naive-ui 虚拟列表（NSelect 下拉）可能不渲染选项；真实 Chrome / Tauri WebView2 正常。
- tiktoken 词表约 2.6MB（gzip），桌面应用可接受；后续可换按需编码器（见优化文档）。
- Tauri 打包需本机安装 Rust 工具链；无 Rust 时以浏览器模式运行全部功能（存储落到 IndexedDB）。
