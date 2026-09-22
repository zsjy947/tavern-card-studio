# 可参考内容

## 本地
1. "D:\AAA_files\downloads\DIY"：reference和output有一些现成的角色卡样例；"D:\AAA_files\downloads\DIY\.claude\skills\st-novel-card"是之前形成的生成skill；其余是其他agent生成的一些脚本
2. "D:\AAA_files\downloads\SillyTavern\角色卡"：图片格式的角色卡
3. "D:\AAA_code\python\SillyTavern"：酒馆本体
4. "D:\AAA_code\python\tavern-card-studio-fail"：之前生成的一个类似的demo，但是效果太简单了我非常非常不满意，仅供参考

## 远程
1. https://github.com/andclear/piney.git ：类似的角色卡工作站，但是使用web开发
2. https://github.com/ghostboyfriends/sillytavern-Novalcard ：小说角色卡提取器


# 酒馆角色卡生成器（TavernCard Studio）项目规划

本地桌面端 SillyTavern 角色卡工作站：转换、编辑、模板美化、AI 辅助生成、诊断修复、同人卡工坊。功能蓝本参考 **piney**（工作站形态、PNG 编解码、美化三件套、小皮医生），流水线与提示词体系参考 **Novalcard**（小说→成卡全流程）。

## 1. 技术栈与形态

| 项 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | **Tauri 2**（Rust 仅做壳） | exe 约 10-20MB、启动快；业务逻辑 99% TypeScript |
| 前端 | **Vue 3 + TypeScript + Vite + Pinia + Naive UI** | 表单/表格密集界面效率高 |
| 编辑器 | CodeMirror 6（JS/HTML/正则）+ iframe 沙箱预览 | |
| 存储 | SQLite（tauri-plugin-sql）+ 本地文件 | |
| 插件 | tauri-plugin-http / fs / dialog / sql | HTTP 走插件避免 CORS，API key 不出本机 |
| 核心依赖 | js-tiktoken（token 计数）、JSZip（epub 解析+备份打包）、zod（schema 校验） | |

**数据目录**：便携模式优先（exe 同级 `./data`），失败回退 AppData（借鉴 piney）。内置模板打包进 `resources/`，首次启动复制到数据目录供用户修改。

## 2. 核心领域库 `src/core/`（纯 TS，与 UI 解耦，可单测）

1. **card/**：chara_card_v2 + v3 完整类型定义（zod schema）；V1→V2→V3 迁移；V2/V3 归一化（顶层 `data` 展开、tags 数组/字符串兼容、creator 回退）。
2. **png/**：PNG tEXt chunk 手写解析/注入。导入：优先 `ccv3`，回退 `chara`，base64→UTF-8 JSON，失败按原文处理；导出：**默认双写 `ccv3`+`chara`**（保证 ST 识别，可选项）。无元数据给出明确报错。
3. **lorebook/**：内嵌 `character_book`（嵌套：keys/secondary_keys/insertion_order/position: before_char|after_char）⇄ ST 全局世界书（扁平：uid/key/keysecondary/order/position 数值/depth/probability…）双向互转。
4. **regex/**：ST `extensions.regex_scripts` 模型（scriptName/findRegex/replaceString/trimStrings/placement/markdownOnly/promptOnly/minDepth/maxDepth 全字段），"简化模式/高级模式"两档 UI。
5. **script/**：酒馆助手脚本（extensions.TavernHelper_scripts）与 QuickReply 的导入/导出/编辑模型。
6. **template/**：变量引擎（`{{user}}/{{char}}/自定义变量` 替换）+ 各类模板的加载/实例化。
7. **llm/**：OpenAI 兼容 chat/completions 客户端（**流式 SSE**、429/5xx 重试、`finish_reason=length` 截断续写、思考标签剥离、JSON 鲁棒抽取）；生图客户端（OpenAI 兼容 `images/generations` b64 + NovelAI 原生 `/ai/generate-image`）；渠道管理。
8. **stats/**：js-tiktoken（cl100k）token 分类统计（正则四类：spec/wb/other/total，借鉴 piney）、字数、AI 用量。

## 3. 数据库设计（SQLite）

```
cards(id, name, spec, tags, category_id, data_json, cover_path, token_stats, data_hash, deleted_at, created_at, updated_at)
card_versions(id, card_id, version_no, note, data_json, created_at)      -- 快照/回滚
templates(id, kind[card|statusbar|regex|prompt], name, payload_json, builtin, created_at)
skills(id, name, system_prompt, steps_json, output_schema, builtin)       -- 诊断/生成技能
ai_channels(id, name, kind[text|image], base_url, api_key, model_id, is_active)
ai_usage_logs(id, channel_id, feature, prompt_tokens, completion_tokens, ms, created_at)
novel_projects(id, title, source_path, chapters_json, pipeline_state_json, created_at)  -- 同人卡项目断点续跑
settings(key, value)   categories(id, name, sort)
```

## 4. 功能模块（对应需求逐条）

### 4.1 图片⇄JSON 转换（M1）
PNG→JSON、JSON→PNG（选底图嵌入）、批量转换（打 zip）、完整性校验报告。导入自动归一化 + `data_hash` 去重 + 建初始版本快照。

### 4.2 卡片编辑器（M1-M2）
Tab 式：**基础信息**（name/personality/scenario/tags/creator/system_prompt/post_history_instructions）、**描述与开场白**（description、多开场白 alternate_greetings 管理 + HTML 渲染预览、mes_example）、**世界书**（表格 + 条目编辑器，与全局世界书互导）、**正则**（简化/高级模式，CodeMirror + 对示例文本实时预览）、**脚本**（CodeMirror JS）、**扩展**（depth_prompt 等）。每个文本区带 token/字数统计 + 「AI 生成/优化/翻译」按钮。

### 4.3 前端美化模板（M2）
- **状态栏模板结构**：`{name, html, css, js, regex_scripts[], worldinfo_entry, variables[], preview_mock}`；iframe sandbox 实时预览，mock 数据注入变量。
- **一键插入卡片**：写入 first_mes/description + 注册正则脚本 + 添加世界书条目（三件套落位，借鉴 piney 皮皮工作台）。
- **状态栏嵌图**：本地图片 → 压缩（webp/jpeg 质量可调）→ base64 data URL 内嵌，附 PNG 卡体积影响警告。
- 内置 3-5 套模板（简约数值栏/六维属性图/带立绘卡面/手机聊天 UI 风），支持新建/复制/导入导出。
- **AI 美化工作台**：AI 一次生成「正则+HTML+世界书」三件套，实时渲染，点击选中元素定向修改。

### 4.4 模板中心（M2）
内置卡片模板（YAML 结构，移植 Novalcard 5 套：默认全档/事件导向/精简人设/NPC 配角/空白）+ 状态栏模板 + 正则模板 + 提示词模板；用户新建/编辑/导入导出 JSON。
**完整生成向导**：选模板 → 填基础设定 → 分步生成整卡（description→personality→first_mes→世界书），每步人工确认。

### 4.5 AI 中心（M1 起）
多渠道管理（文本/生图分开，一键测连、拉模型列表、全局自定义系统提示词）；单字段生成/优化/翻译；生图生成头像直接作卡面底图；全部调用记入 ai_usage_logs 供统计。并发限制 + 失败重试。

### 4.6 诊断与调整（M3）
- **静态检查**（本地即时）：schema 校验、字段缺失、token 超限、世界书键冲突、正则语法错误、嵌图体积。
- **LLM 诊断 skill**：skill = `{system_prompt, steps, output_schema}`，可配置/新建/导入导出。内置「卡医」skill：多轮 agent（可申请读取指定世界书条目），输出结构化报告（核心评估/维度诊断/处方），借鉴 piney 小皮医生 + Novalcard 自检（OOC/经历互串/时间线/编造）。
- 修复建议 → **diff 预览 → 应用** → 自动存版本快照。

### 4.7 同人卡工坊（M3）
- 导入 **txt + epub**（JSZip 解包 xhtml、DOMParser 取正文、保留章节结构——Novalcard 只支持 txt，此处补齐）。
- 流水线（项目化保存、断点续跑）：章节切分 → 角色扫描（分块调 LLM，支持合并别名/人生阶段拆分）→ 选角色 → 上下文检索（命中段落过滤，超限跨全书等距采样）→ YAML 抽卡（按所选模板）→ 世界书 6 类任务（世界观条目/共享背景蓝灯/配角群像/剧情分段/人物列表/剧情大纲）→ 文风蒸馏 → 开场白 → user 人设 → **打包导出 PNG+JSON**。
- 修改意见迭代式修订 + 自检步骤；提示词库以 Novalcard 体系为初版（只依据原文/不臆造/具体事件、禁空泛套话）。

### 4.8 数据管理与版本（M1-M3）
卡库（分类/标签/搜索/软删除回收站/批量操作/批量导出 zip）；版本管理（保存自动快照 + 手动存档、列表、回滚、两版本 diff）；统计看板（卡数/模板数/数据体积/token 分布/AI 调用量趋势）；全量备份导出/导入 zip。

## 5. 分期与验收标准

**M1 核心可用**：脚手架 + 数据层 + 卡片模型/PNG 编解码 + 转换工具 + 卡库 + 编辑器（基础/世界书/正则）+ 版本快照 + AI 渠道 + 单字段生成/优化/翻译。
验收：导入一张现有 PNG 卡 → 编辑世界书与正则 → AI 改写描述 → 导出 PNG，SillyTavern 可正常识别加载。

**M2 模板与美化**：模板中心 + 状态栏模板预览/一键插入 + 嵌图工具 + AI 美化三件套 + 脚本编辑 + 完整生成向导 + 生图接入（OpenAI images + NovelAI）。
验收：用内置状态栏模板美化一张卡并导出，ST 中渲染出状态栏；从零用向导生成一张完整卡。

**M3 诊断与同人**：静态检查 + LLM 诊断/修复 + skill 管理 + 同人卡工坊全流程 + 统计看板完善 + 备份。
验收：导入一本 epub 小说，走完流水线产出成卡；对一张外部卡跑诊断并应用修复。

## 6. 工程结构与打包

```
tavern-card-studio/
├── src/            # Vue 前端（core/ 为纯 TS 领域库，views/ 按模块分页面）
├── src-tauri/      # Tauri 2 壳（NSIS 配置、便携模式启动逻辑）
├── resources/templates/   # 内置模板资产
└── package.json
```
- 测试：vitest 覆盖 core 纯函数（PNG codec、V2/V3 迁移矩阵用真实卡样本、世界书互转、变量引擎、LLM JSON 抽取）。
- 打包：`tauri build` 产出 NSIS 安装器（x64）+ portable 目录版；可选 GitHub Actions。
- 安全：API key 仅存本地 SQLite；美化预览 iframe sandbox；无任何遥测/上传。

## 7. 主要风险与对策
1. **tauri-plugin-http 流式 SSE 兼容性** → 备选方案：Rust reqwest 流式命令 + Tauri event 转发（仍只增加少量 Rust）。
2. **状态栏预览与 ST 实际渲染差异** → 预览器尽量复刻 ST 的 HTML 渲染容器规则，模板文档注明注入位置，引导在 ST 中最终验证。
3. **base64 嵌图导致 PNG 体积膨胀** → 压缩策略 + 体积上限警告 + 可选外链模式。
4. **V2/V3 字段差异兼容** → zod 严格 schema + 真实卡片样本迁移测试矩阵。
5. **长小说上下文超限** → 分块 + 等距采样 + 断点续跑（Novalcard 已验证可行，直接移植策略）。


# 自然语言版需求说明

1. 一定要有好看合适的UI，像"D:\AAA_code\python\tavern-card-studio-fail"的UI就是一个失败的UI
2. 最基础的角色卡生成功能，进行分类分步填写，最好能达到小白也能做出一个基础的纯文字角色卡
3. 预置正则/脚本、界面美化属于高级功能，尽可能设计的操作简单一点；如果实在难以做到，复杂一点也可以
4. LLM引入分为两类，原有角色卡分步填写，每类都可以给个AI优化，你可以按类设置提示词，点击即可一键优化（提示词可以构建一个模板库）；另一类是完全AI生成的界面，同样设置一套提示词（同时可以让AI对角色卡模板库进行填写）
5. 制作出一张角色卡后，可以对角色卡当前使用类别、美化等沉淀为模板
6. 图片嵌入角色卡不采用base64嵌图，采用外链格式，但是注意要可以选择本地文件夹或者在线链接（D:\AAA_files\downloads\DIY里的示例有使用本地的，也有使用在线的）
7. 要有版本管理功能，可以及时回退，采用本地数据库
8. 对外部导入的角色卡，可以进行AI智能诊断和二次创作
9. 测试："D:\AAA_files\downloads\DIY\origin\穿成女频男主，我天天报警.txt"为一部小说，以此来测试同人卡制作流程