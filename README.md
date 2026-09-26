# TavernCard Studio · 酒馆角色卡工作站

本地桌面端 **SillyTavern 角色卡工作站**：转换、编辑、模板美化、AI 辅助生成、诊断修复、同人卡工坊。

- **格式与酒馆完全兼容**：PNG 读取优先 `ccv3` 回退 `chara`（对齐 ST `character-card-parser.js`）；导出默认双写 `ccv3 + chara`；世界书互转对齐 ST `convertCharacterBook`，ST 专属字段（递归/概率/深度/分组）存于条目 `extensions` 不丢失。
- **数据全在本地**：Tauri 桌面模式 SQLite（便携 `./data`，失败回退 AppData）；浏览器模式 IndexedDB。API Key 不出本机，无遥测。
- **业务 99% TypeScript**：Rust 只做壳（SQL 插件、字体/导出落盘、LLM 流式代理、大文件直连下载），核心逻辑全部在 `src/core/` 纯 TS 领域库，可单测。

## 快速开始

```bash
npm install
npm run dev        # 浏览器模式（IndexedDB 兜底存储）
npm test           # vitest：140+ 用例（PNG 编解码/迁移矩阵/世界书互转/LLM mock/导出目录/社区卡回归等）
npm run typecheck  # vue-tsc
npm run build      # 生产构建
```

### 打包桌面版（需要 Rust 工具链）

```bash
npm install -D @tauri-apps/cli   # 如未安装
npx tauri icon src-tauri/icons/icon.png   # 生成各尺寸图标
npm run release                  # tauri build + 产物收集到 release/（便携 exe + NSIS 安装包）
```

Tauri 壳已配置：`withGlobalTauri` + `plugin:sql`（SQLite）+ dialog/fs 插件、便携模式数据目录逻辑；自定义命令：`http_get_bytes`（大文件直连下载）、`font_*`（字体落盘）、`llm_post_stream`/`llm_cancel_stream`（LLM 流式代理）、`export_*`（全局导出目录）。前端通过 `window.__TAURI__.core.invoke` 调用，web 构建保持零 Tauri 依赖。

## 功能地图

| 模块 | 能力 |
|---|---|
| 卡库 | 分类树/搜索/标签筛选/回收站（软删除）/批量导出 JSON·PNG（封面作底图）/导入去重/两卡对比入口 |
| 编辑器 | 七 Tab：基础信息 / 描述与开场白（HTML 预览）/ 世界书（ST 互导）/ 角色成员（多人卡条目结构化编辑）/ 正则（简化+高级、实时测试）/ 脚本（CodeMirror JS）/ 扩展（depth_prompt + 原始 JSON 全屏抽屉）；封面设置/更换/移除；每字段 token 统计 + AI 生成/优化/翻译；本地撤销/重做 |
| 转换工具 | PNG⇄JSON 批量互转、完整性校验报告、双写开关、底图显式选择 |
| 生成向导 | 选模板（5 套）→ 一句话设定扩写 → 字段工作台（全部字段常驻手填 + AI 可选 + 自定义字段 + 角色成员清单→世界书条目）→ 入库 |
| 美化工作台 | 状态栏模板（5 套：数值栏/六维雷达/立绘卡面/手机 UI/多人群像）、变量工作台（key 可改、增删行、改名重写器同步 HTML/JS/世界书说明）、iframe 沙箱实时预览、三件套一键插入（占位符+正则+世界书规则条目），图片走外链 |
| 模板中心 | 四类模板（card/statusbar/regex/prompt）结构化编辑（builtin 自动落副本）、从卡沉淀（字段/正则/状态栏元数据）、导入导出 JSON |
| AI 中心 | 多渠道（文本/生图分开，OpenAI 兼容 + NovelAI）、测连（最小 chat POST）、拉模型、生图测试、用量记录；四级超时与错误体识别 |
| 诊断与调整 | 静态检查（秒出：schema/token/键冲突/正则语法/嵌图体积）+ 卡医 LLM 诊断（维度评分+处方）→ diff 预览 → 应用 |
| 同人卡工坊 | txt/epub 导入 → 章节切分 → 角色扫描（边缀折叠词频）→ 上下文检索（等距采样）→ 抽卡+世界书六类 → 文风蒸馏 → 开场白 → user 人设；项目化保存断点续跑 |
| 版本管理 | 保存自动快照（上限 50）、版本列表、两版 diff、回滚 |
| 统计看板 | 卡数/模板/体积/token 分布/AI 调用趋势与功能排行 |
| 设置与备份 | 全量备份 zip（合并或清空恢复）、全局导出文件夹（默认 exe 同级 data/exports/）、主题、字体、PNG 双写等偏好 |
| 外观 | 5 套主题一键切换（暗夜·幽紫 / 晨白浅色 / 书卷·纸墨 / 竹林·青韵 / 墨海·黛蓝，含纸纹竹影纹理）、界面字体在线安装（霞鹜文楷/思源宋体/朱雀仿宋/汇文明朝体/悠哉字体，开源 SIL OFL）与本地导入 |
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
│   │   ├── llm/    # OpenAI 兼容客户端（SSE/重试/续写/超时/错误体）+ 流式代理适配 + 生图
│   │   ├── theme/  # 主题定义与 CSS 变量
│   │   ├── font/   # 字体目录元数据
│   │   ├── novel/  # txt/epub 解析、章节、角色扫描、上下文采样
│   │   └── diag/   # 静态检查
│   ├── db/         # 存储抽象：Memory / IndexedDB / Tauri SQLite（并发互斥 + 降级提示）
│   ├── services/   # 业务服务（卡片/模板/AI/美化/导出/诊断/工坊/备份/字体/偏好）
│   ├── builtins/   # 内置模板资产（按 id 增量播种 + builtin 行随版本刷新）
│   ├── stores/     # Pinia（workspace / appearance）
│   ├── components/ # CardCover / FieldAiButton / HtmlPreview / CodeEditor / AppearanceSettings / CommandPalette 等
│   └── views/      # 11 个页面 + editor 七 Tab
├── src-tauri/      # Tauri 2 壳：commands/{db,http,fonts,llm,export}
├── tests/          # 服务层集成测试 + 真实社区卡导入回归（样本缺失自动跳过）
├── docs/           # 架构说明（ARCHITECTURE.md）与待改进清单（ROADMAP.md）
└── scripts/        # collect-release.mjs（release/ 产物收集）
```

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 实际实现的架构与功能（core 模块 / 数据层 / 服务流程 / Tauri 命令 / 视图层约定 / 主题与字体 / 测试策略）
- [docs/ROADMAP.md](docs/ROADMAP.md) —— 待改进清单（功能增强 / 体验深化 / 工程远期 / 审查遗留）与已知事项

## 设计决策速览

1. **宽容读取、规范写出**：解析社区卡时未知字段 passthrough 保留；导出补齐顶层冗余字段（旧前端只读顶层）。
2. **整对象存储**：所有表以 `{id, json}` 形态存储（SQLite JSON 列 / IndexedDB object store），本地规模下免去 ORM，双驱动行为一致、测试可用 MemoryStore。
3. **响应式消毒**：服务层入口对 Vue Proxy 做 JSON 往返（IndexedDB 结构化克隆不支持 Proxy，structuredClone 也会抛错）。
4. **token 统计防巨串**：超 8K 字符片段走粗估，避免 BPE 对 base64 嵌图的二次方级耗时。
5. **图片外链化**：美化状态栏图片本地路径自动转 `file://`，base64 内嵌给出警告（卡封面除外，随行存储且导入导出 PNG 自动复用）。
