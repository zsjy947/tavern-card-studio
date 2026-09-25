# TavernCard Studio 第三轮迭代规划：多人卡支撑 · 编辑器体验 · 全链路修复

> 基于 dev 分支（主题系统与字体系统已落地的 `4bf6718` 之后工作区）的探查结论，覆盖用户 11 项反馈。
> 本文档是**规划**，批准时仅落盘、不实施；执行时按 §12 批次推进，每批独立回归。
> 探查方式：三路并行代码审查（全部结论含 file:line 证据）、参考卡样本分析（`D:\AAA_files\downloads\SillyTavern\角色卡\discord类脑` 13 张卡）、GLM 端点 curl 实测探针。
>
> **决策基线（用户已确认）**：
> ① 多人卡 = 中等深度（模板映射修正 + 编辑器「角色成员」面板 + 基础信息栏重排）；
> ② LLM = 客户端健壮性修复（P0）+ 桌面 Rust 流式代理（P2）；
> ③ 目录重构 = 根目录整理 + release/ 规范 + `lib.rs` 拆分 commands/ 模块；`src/` 分层不动。

## 0. 总览

| # | 事项 | 根因摘要 | 批次 |
|---|---|---|---|
| 1 | 空白模板流程死路 | 生成前无手填入口 + canFinish 永假 | P0 |
| 2 | 多人卡字段体系 | 模板复用 personality 槽位直写；缺世界书角色条目工作流 | P1 映射 / P2 面板 |
| 3 | 扩展栏 UI + 主题补全 | raw 编辑器挤压布局；HtmlPreview 硬编码深色 | P1 |
| 4 | 转换工具卡死 | 底图对话框取消不触发，busy 永真 | P0 |
| 5 | 美化 key 可编辑 + 多人状态栏 | 变量 key 三处硬编码耦合 | P2 |
| 6 | 模板中心沉淀扩展 + 编辑 | 沉淀写死 card kind；编辑功能缺失 | P2 |
| 7 | LLM 渠道健壮性（GLM） | 测连假成功/误判死、无超时、静默空文本 | P0 客户端 / P2 代理 |
| 8 | 主题切换过渡统一 | naive 渐变与自绘变量瞬时切换不同步 | P1 |
| 9 | 字体 UI 精简 + 已装列表刷新 | init 单 try 吞错 + 启动竞态 | P0 刷新 / P1 UI |
| 10 | 使用指南目录常驻 | naive 滚动容器 sticky 几何失效 | P1 |
| 11 | 目录整理 + gitignore + release 规范 | 根目录散乱、lib.rs 堆积、产物无规范 | P2（可先行） |

---

## 1. 空白模板流程打通：生成前可写 + 自定义字段（P0）

### 根因（死路精确链条）
- 内置「空白」模板 fields 只有 `name` + COMMON_TAIL（`cardTemplates.ts:85-93`），不含任何 GEN_ORDER key → `genFields` 为空（`WizardView.vue:46-51`）→ 步骤 3 只渲染 `<NEmpty>`（:213）。
- 字段输入框是 `<NInput v-if="outputs[f.key]">`（:224）——**只在 AI 生成过之后才出现**，`outputs` 无任何手动新增入口。
- `canFinish = cardName && outputs.first_mes && outputs.description`（:129）→ 空白模板下永假 → 「生成整卡并入库」永久 disabled（:230）→ 用户被锁死在步骤 3。
- 顺带缺陷：`draftTags` 声明后无 UI 绑定（:34）；`autoMode='auto'` 无实际行为差异（仅 :97-99 一条警告）。

### 方案
1. **步骤 3 改造为「字段工作台」**：模板 fields 全部常驻渲染（不再 v-if 生成产物）；每字段 = 常驻 textarea（手填）+ 「AI 生成」按钮（可选动作，已有 `genField` 逻辑复用）；`genAll` 只跳过已有值的字段。
2. **自定义字段**：工具条「+ 添加字段」（key/label 自定义，key 校验 `^[a-z_][a-z0-9_]*$` 防撞保留字段）；`finish()` 既有逐 key 直写 `card.data` 路径（:138）天然承载，无需新映射层。
3. **canFinish 放宽**：`name + description + first_mes` **有值即可**（手填与 AI 生成等价，读 `outputs` 统一收集）。
4. 空白模板的 fields 增加空的 `description` / `first_mes` 空槽（label 按 WYSIWYG），保证工作台有最小可用骨架。

### 改动文件
`WizardView.vue`（主体）、`builtins/cardTemplates.ts`（BLANK 槽位）、`builtins/promptTemplates.ts`（预计不动）。

### 验收
空白模板走通：选模板 → 步骤 2 填名 → 步骤 3 手写 description/first_mes（或加自定义字段）→ 入库 → 编辑器各 Tab 字段可见。事件导向模板生成前同样可手填、生成后可改。

---

## 2. 多人卡字段体系：模板修正 + 角色成员面板（P1 映射 / P2 面板）

### 根因
- **映射错位**：EVENT 模板把标准字段 key `personality` 复用为「NPC 性格速写」槽位（`cardTemplates.ts:53`），`finish()` 逐 key 直写（`WizardView.vue:138`），编辑器按「性格」展示（`BasicTab.vue:31-41`）；LLM 侧 system 提示词又按单人「性格」口径框定（`promptTemplates.ts:18,31`）——"林婉"卡的错位即此路径。`FieldAiButton` 按 key 找提示词回写同 key（`FieldAiButton.vue:41-59`），不会纠正语义。
- **参考卡惯例**（discord类脑 13 卡实测结论）：现代中文社区多人卡普遍 `description/personality/scenario` **留空**；角色设定全部进 `character_book`——主角一人一条 `constant=true, keys=[]` 的 YAML 结构条目（name/age/gender/identities/分层设定），配角按称呼关键词触发（`constant=false` + keys），世界观/机制/变量/输出格式各自独立 constant 条目；基础信息栏实际只承载 name/first_mes/tags。

### 方案
1. **模板映射修正（P1）**：EVENT/NPC 模板的「NPC 性格速写」槽位废除 personality key 复用，改为生成**世界书角色条目**（`promptTemplates.ts` 新增 `wizard:worldbook-char` 提示词：每成员一条 YAML 条目，主角 constant、配角给触发词）；EVENT 的 `description` 槽位 hint 同步改「世界与事件规则（成员设定请用角色成员生成）」。
2. **向导角色成员清单（P1）**：步骤 2/3 之间或完成阶段支持录入成员名单（名称+主/配+称呼别名），finish 时逐成员调用世界书条目生成，写入 `character_book.entries`。
3. **编辑器「角色成员」Tab（P2）**：新组件 `CharacterMembersTab.vue`，启发式识别 `character_book.entries` 中的角色条目（comment 命中成员名 / keys / YAML `name:` 字段），提供结构化编辑：名称、主角（constant）或配角（触发词编辑）、YAML 内容编辑区；保存即写回条目本质（复用 WorldbookTab 的落库路径）。识别不出的条目不展示（由世界书 Tab 管理）。
4. **BasicTab 重排（P2）**：按多人卡心智——name 标注「卡名 / 世界观名」；description 标注「世界与规则总述（多人卡可留空，成员设定放世界书）」；personality/scenario/creator_notes 等折叠进「单人卡经典字段（多人卡可留空）」分组（NCollapse）。

### 改动文件
`builtins/cardTemplates.ts`、`builtins/promptTemplates.ts`、`WizardView.vue`、`views/EditorView.vue`（Tab 注册）、新 `views/editor/CharacterMembersTab.vue`、`views/editor/BasicTab.vue`。

### 验收
事件导向模板生成含 3 NPC 的卡：成员设定出现在世界书条目（YAML、主角 constant/配角触发词），personality 为空或为「整体基调」；"林婉"类既有卡在角色成员面板可见可编辑；单人模板（FULL）流程不受影响。

---

## 3. 编辑器扩展栏重设计 + 主题背景补全（P1）

### 根因
- raw JSON 段首次激活才挂载 480px CodeEditor（`ExtensionsTab.vue:107`，NTabPane 懒渲染），切换即大幅挤压布局——即用户描述的「点击前缩起、点击后展开挤压 UI」。
- **主题未覆盖处**：`HtmlPreview.vue:22-24,27` iframe 底/字色硬编码（theme prop 缺省 dark）→ 浅色主题下「描述与开场白」页的渲染预览仍是深底；`ExtensionsTab.vue:121` `.raw-apply { color: #fff }` 硬编码；`App.vue:46` `.n-layout-scroll-container` 选择器在 `native-scrollbar=false` 下是死规则（该 DOM 节点不存在）。
- BasicTab/GreetingsTab/EditorView 自身样式已全走 `--tcs-*` 变量（复查无硬编码背景）。

### 方案
1. **ExtensionsTab 重排**：改为「左侧扩展项列表（depth_prompt / talkativeness / fav / world / 原始 JSON）+ 右侧编辑区」两栏；「原始 JSON」改为按钮打开**全屏抽屉/Modal**（CodeEditor 移入），不再挤压布局；`applyRaw` 的最小形状校验契约（缺 `data` / `character_book.entries` 非数组会崩其他 Tab，:41-46 注释）原样保留；raw 打开期间表单改动需在打开时重新序列化（修 :33-35 只序列化一次的陈旧问题）。
2. **HtmlPreview 跟随主题**：`theme` prop 缺省改为读取全局 appearance 的 mode（computed），显式传入仍优先；GreetingsTab/BeautifyView 预览自动受益。
3. `.raw-apply` 文字色改 `var(--tcs-surface)`/对比色；删除 App.vue 死规则（面板透明化改用实际存在的 DOM 路径）。

### 改动文件
`views/editor/ExtensionsTab.vue`、`components/HtmlPreview.vue`、`App.vue`、（如需）`views/editor/GreetingsTab.vue`。

### 验收
浅色/书卷主题下开场白预览为浅底；扩展页切换原始 JSON 不挤压布局、应用 JSON 功能不回归；五主题截图抽查编辑器全部 Tab。

---

## 4. 转换工具卡死修复（P0）

### 根因
- json2png 流程 `busy=true` 后**串行弹第二个文件对话框**选底图（`ConverterView.vue:71`）；`pickFiles` 的 promise 只靠 `input.onchange/oncancel` resolve（`file.ts:18-31`），WebView2/旧内核下 `cancel` 事件不触发 → **取消底图 = promise 永久 pending → busy 永真转圈**。用户导入的侯府 JSON（209KB 标准 v3 卡，43 条世界书 + regex_scripts）实测解析毫秒级，文件本身无辜。
- 次因：两条转换链路均无 try/finally 兜底（:58、:96 的 rejection 会卡 busy）。

### 方案
1. `pickFiles` 加取消兜底：`window focus`/`document visibilitychange` 后检测无 `change` 即 resolve 空数组（保留 oncancel 优先）。
2. ConverterView 全流程 `try/finally busy=false`。
3. 底图选择改显式 UI：json2png 面板加「底图：无（占位图）/ 选择 PNG…」选项，不再隐藏式串行弹窗；无底图走既有 `makePlaceholderPng`。

### 改动文件
`utils/file.ts`、`views/ConverterView.vue`。

### 验收
导入侯府 JSON 秒级出结果；取消/跳过底图不卡死；png2json 批量路径同样受 finally 保护。

---

## 5. 美化工作台：key 可编辑 + 多人状态栏（P2）

### 现状
- 变量 key 硬编码三处耦合：模板 html 的 `{{getvar::xxx}}`、`variables` 数组、世界书条目说明文案（`statusbarTemplates.ts` 四套模板各处）；六维模板 js 还按名直读 `vars.stat_str` 等（:129-138），改名最敏感。
- BeautifyView 变量区仅**值**可编辑（:113-119），key/label 只读。

### 方案
1. **变量工作台**：变量区支持增删行 + key/label 可编辑；`varValues` 以 key 为 map 键（:47-48），改名时同步迁移已填值。
2. **改名重写器**：对 `html/css/js/previewMock/worldinfoEntry.content` 四处做 `{{getvar::old}}→{{getvar::new}}` 与 js 对象键名替换（纯字符串替换 + 词边界校验）；六维模板 js 改为按 variables 遍历取值（消灭硬编码键名直读）。
3. **多人状态栏**：`StatusbarVariable` 增加可选 `group`（角色/所有者）字段；新增第五套内置模板「多人群像栏」——变量按角色分组（如 `林婉_favor`），HTML 渲染分组卡片；`buildStatusbarWorldinfo`（beautifyService.ts:63-79）按组生成说明。

### 改动文件
`builtins/statusbarTemplates.ts`、`views/BeautifyView.vue`、`services/beautifyService.ts`。

### 验收
把任意模板的「金钱」改名「灵石」→ 插入三件套后 HTML 渲染、世界书说明、JS 取值全部同步；多人模板可配置 ≥2 角色分组并正常插入。

---

## 6. 模板中心：沉淀扩展 + 模板编辑（P2）

### 现状
- `sinkFromCard` 写死 `kind:'card'`、只提取 8 个纯文本字段（`TemplateCenterView.vue:110-127`），不读世界书/正则。
- **编辑功能完全缺失**：只有复制/导出/删除/预览与「新建=手贴 JSON」（:159-172,182-201）；`updateTemplate` 服务层存在但全项目零调用（`templateService.ts:52-57`）。

### 方案
1. **正则模板沉淀（无损）**：读取 `data.extensions.regex_scripts[]`，逐条列出勾选 → 直接包成 regex kind payload（结构与 `builtins/regexTemplates.ts:8,13-14` 一致）入库。
2. **状态栏模板沉淀（需元数据）**：插入三件套时把 `StatusbarPayload` 序列化存入正则脚本/世界书条目的 `extensions.tcsStatusbarPayload`（社区卡 extensions passthrough，ST 侧多余字段被忽略；兼容性在实施时用真机验证），沉淀时读回反解；无元数据的旧卡保持现状（不提供状态栏沉淀）。
3. **模板编辑**：按 kind 提供编辑弹窗——card=字段表单、regex=抽取 RegexTab 的单脚本编辑器组件复用、statusbar=HTML/CSS/JS/变量编辑；保存走 `updateTemplate`；`builtin` 模板编辑时自动落副本（builtin 标记不可覆盖，沿用 clone 语义）。

### 改动文件
`views/TemplateCenterView.vue`、`services/templateService.ts`、`services/beautifyService.ts`（插入时存 payload）、（抽取）`views/editor/RegexTab.vue` 的编辑器组件。

### 验收
含 3 条 regex_scripts 的卡可一键沉淀为正则模板并出现在模板中心；任一模板可编辑保存、新卡应用生效；builtin 编辑产生副本且原 builtin 不变。

---

## 7. LLM 渠道健壮性 + 桌面 Rust 流式代理（P0 客户端 / P2 代理）

### 实测根因（GLM 现象逐条对应）
| 现象 | 根因链 |
|---|---|
| `/api/v1`「能连上但请求没反应」 | 旧网关鉴权失败也返回 **HTTP 200** + 旧格式错误体 `{"code":401,...}`（无 choices/非 SSE）。测连只看 `res.ok`（client.ts:245）→ 假「连接成功」；聊天按非 SSE 走、:112 取不到 `choices` → **静默返回空文本** |
| `/api/coding/paas/v4`「完全连不上」 | 拼接出的 chat 端点正确且 CORS 通（实测）。测连第一步 `GET /models` 对 coding key 返回 **401**（无 models 权限），401≠404 不降级 chat 探测（client.ts:246-251）→ 直接报 `HTTP 401` 被理解为连不上 |
| 长时间无反应/永久转圈 | **全链路无超时**（client.ts:215-237；SSE 读循环无 idle 超时 :148-176）；文本并发默认 2（aiService.ts:57-66），两个挂起请求排死全部后续 AI 调用 |
| 解析异常被吞 | SSE 解析失败行静默跳过（client.ts:174 空 catch） |
| 附注 | `fetchImpl` 注入点存在但生产代码从未注入（aiService.ts:52、AiCenterView.vue:61,74 均默认 webview fetch）；GLM/DeepSeek 实测 **CORS 均通**，非本次主因，但代理可一劳永逸 |

### 方案
- **A. 客户端健壮性（P0）**：
  - 测连改为**直接 POST 一条最小 chat**（max_tokens=5，retries=0）为主，`/models` 仅作拉模型列表用；
  - 非流式响应体校验：HTTP 200 但 body 含 `error` / `code` / `success:false`（非 OpenAI 形状）→ 抛 `LlmError` 并携带服务端 `msg`；
  - 三级超时：连接 15s / 首 token 60s / SSE idle 60s（可配），全链路兜底；
  - SSE 流以非流式回退或报错收尾，不再静默空文本。
- **B. 厂商路径提示（P0）**：AiCenterView baseUrl 占位与帮助文案列出主流厂商（GLM: `https://open.bigmodel.cn/api/paas/v4`；GLM Coding: `…/api/coding/paas/v4`；DeepSeek: `https://api.deepseek.com`），注明「填到版本号一级，/chat/completions 自动追加」。
- **C. Rust 流式代理（P2）**：`lib.rs`（拆分后 `commands/llm.rs`）新增 `llm_post_stream(url, headers, body, on_chunk: tauri::ipc::Channel)`：reqwest 加 `stream` feature + `futures-util`，`bytes_stream()` 逐块 `channel.send`；取消机制（会话 id + 取消命令）；JS 侧 `TauriStreamFetch` 适配器把 Channel 事件合成 `Response`，`aiService`/`AiCenterView` 在 `isTauri()` 时自动注入 `fetchImpl`（注入点即 client.ts:62 现成接缝）。

### 改动文件
`core/llm/client.ts`、`services/aiService.ts`、`views/AiCenterView.vue`、`src-tauri/Cargo.toml`、`src-tauri/src/commands/llm.rs`（新）、`src-tauri/src/lib.rs`。

### 验收
GLM coding 渠道测连成功并可流式对话；误填 `/api/v1` 得到含服务端 msg 的明确报错而非空响应；断网时 15s 内报错；DeepSeek 回归不受影响。

---

## 8. 主题切换过渡统一（P1）

### 根因
两速不同步：naive GlobalStyle 给 body 设 `transition: color .3s / background-color .3s`（常驻），而全部 `--tcs-*` 消费元素（背景纹理层、边框、自绘文本）瞬时跳变——观感即「底色瞬间换了、字还在慢慢追」。全 src 仅 4 处局部 transition，无残留过渡问题。

### 方案（推荐：全局统一渐变）
- App.vue 全局样式为消费主题变量的层统一 `transition: background-color .25s ease, color .25s ease, border-color .25s ease`（与 naive 同 timing）；范围收窄到 `.tcs-backdrop`、布局面板、卡片/文本容器，**避免 `*` 通配**拖慢 hover 微交互（实施时以性能与手感定夺收窄面）。
- 备选：全部瞬时（`body { transition: none !important }` 覆盖 naive inline），最干脆但少了渐变质感。

### 改动文件
`App.vue`（全局样式）、（如需）`stores/appearance.ts`。

### 验收
五主题循环切换无「文字追底色」错位感；按钮/输入 hover 响应不迟滞；低配机器无明显掉帧。

---

## 9. 界面字体：UI 精简 + 已装列表刷新修复（P0 刷新 / P1 UI）

### 刷新 bug 根因（与用户症状完全吻合）
`installedFonts` 仅两处赋值：`init()`（App.vue:10 一次性 fire-and-forget）与 `refreshInstalled()`（仅下载/导入成功后触发）。`init()` 全流程单 try（appearance.ts:91-121），catch 只 console.error——启动期与 `ensureSeeded/seedSkills`（main.ts:15-19）**并发打同一个 SQLite**（TauriSqlStore 初始化 = db_url + load + 11 张 CREATE TABLE），任一 invoke 瞬时失败 → `installedFonts` **整场停留空数组**；fonts 表数据其实还在，之后任何一次成功的列表刷新（重装/导入）即恢复——即「重开 exe 显示未安装、一切换字体又显示都装好了」。次要隐患：TauriSqlStore 初始化失败会永久静默降级到**空的 IndexedDB**（db/index.ts:17-24）。

### 方案
- **UI 精简（按用户要求）**：移除字体目录介绍列表（描述/来源/体积文案、逐行下载按钮）；改为**单个下拉**：默认字体 + 已安装字体（组1）+ 目录字体（组2，标注「点击下载安装」，选中即自动下载→安装→应用）；下载进度显示为下拉下方一条细进度；保留「导入本地字体」按钮与当前字体的卸载小入口。
- **刷新修复**：`init()` 拆步独立 try/catch（主题偏好、字体列表、字体恢复互不拖垮）；`listInstalled` 失败自动重试 1 次；SettingsView 挂载时主动 `refreshInstalled()`；桌面端启用字体时校验文件存在（`font_read` 探测失败 → 该字体标记「文件缺失」并提供重装）；设置页外观区用 `appearance.ready` 门控显示加载态；`getStore` 降级时一次性提示。

### 改动文件
`components/AppearanceSettings.vue`、`stores/appearance.ts`、`services/fontService.ts`（verifyFile）、`views/SettingsView.vue`。

### 验收
安装字体 → 重启 exe 直接显示已安装并可应用；下拉无介绍文案；人为制造启动竞态（可选）后列表仍能自愈显示。

---

## 10. 使用指南目录常驻（P1）

### 现状与根因
`.guide-toc { position: sticky; top: 8px }`（GuideView.vue:302-305）随内容滚走。滚动发生在 naive NScrollbar 内部（`NLayoutContent native-scrollbar=false` → `.n-scrollbar-container` 为滚动视口）；sticky 失效的候选机制：① 滚动视口高度链未成形（内层 NLayout 无显式高度，`.n-scrollbar-container` 的 `height:100%` 链对不上几何）；② sticky 约束盒与滚动几何错位。同类隐患：LibraryView.vue:311 的 sticky 分类栏同机制。执行时**先 DevTools 实测**（滚动时哪个元素 scrollTop 变化、container 的 clientHeight vs scrollHeight）。

### 方案
- **首选（布局根治）**：内层 NLayout 显式 `display:flex; flex-direction:column`（NLayoutContent 自带 `flex:auto`），使 `.n-scrollbar-container` 成为真正受限视口——所有页面 sticky 一并受益；需 11 页面回归（重点卡库/指南/统计）。
- **降级（局部稳妥）**：GuideView 目录改 `NAffix`（naive 自带，滚动容器内可用）或 scroll 监听 + transform。

### 改动文件
`views/LayoutView.vue`（或 App.vue 布局层）、`views/GuideView.vue`。

### 验收
指南页滚动全程目录可见且高亮跟随；卡库分类栏 sticky 正常；11 页面冒烟 + 浅深主题抽查。

---

## 11. 目录架构整理 + gitignore 重写 + release 规范（P2，可独立先行）

### 方案
1. **临时文件清理**：删除 `.screenshots/`（调试截图，已 ignore）；确认无 `*.log`/散落产物。
2. **lib.rs 拆分**：`src-tauri/src/commands/{db.rs, http.rs, fonts.rs, llm.rs}`（llm.rs 为第 7 项 C 预留），`lib.rs` 仅保留 `run()` + `generate_handler` 注册；Rust 单测随模块走。
3. **.gitignore 重写**（分组注释结构化）：依赖（node_modules/、src-tauri/target/）、构建产物（dist/、dist-ssr/、.vite/、coverage/、*.tsbuildinfo）、Tauri 生成物（src-tauri/gen/schemas/）、本地数据与产物（data/、release/、.screenshots/）、系统（.DS_Store、*.local）。
4. **release/ 规范**（整体 gitignore）：
   ```
   release/
   ├── portable/                                # 免安装版（exe 单文件即可运行，WebView2 为系统组件；运行时自建 data/）
   │   └── tavern-card-studio.exe
   └── TavernCard Studio_0.1.0_x64-setup.exe    # 安装包（单文件直接放 release/ 根，不设子文件夹）
   ```
5. **收集脚本**：新增 `scripts/collect-release.mjs`（tauri build 后把 `src-tauri/target/release/*.exe` 与 `bundle/nsis/*-setup.exe` 复制归位），挂 `npm run release`。

### 改动文件
`.gitignore`、`src-tauri/src/lib.rs`、`src-tauri/src/commands/*`（新）、`scripts/collect-release.mjs`（新）、`package.json`。

### 验收
`git status` 干净；`npx tauri build && npm run release` 后 release/ 结构符合规范；免安装 exe 可直接运行并生成 data/。

---

## 12. 实施批次与回归基线

| 批次 | 内容 | 说明 |
|---|---|---|
| **P0 阻断级** | #4 转换卡死、#1 空白模板、#7A/B LLM 健壮性+路径提示、#9 字体刷新 | 全部为「功能走不通/假成功」级问题，先行 |
| **P1 体验** | #3 扩展栏+主题补全、#8 主题过渡、#9 字体 UI、#10 指南目录、#2 模板映射修正 | UI/视觉批次，需截图验收 |
| **P2 扩展** | #2 角色成员面板、#5 美化 key/多人模板、#6 模板中心、#7C Rust 流式代理、#11 目录整理 | 功能扩展；#11 无依赖可随时插入 |

- 每批完成跑：`npm run test`（vitest）+ `npm run typecheck` + `npm run build`；涉 Rust 批次加 `cargo test`；UI 批次加多主题截图视觉验收。
- 涉及世界书/模板结构的批次（#2/#5/#6）需用真实社区卡（discord类脑样本 + 侯府卡）做导入回归。
- 新增/调整的核心纯逻辑（模板字段收集、改名重写器、错误体识别、超时参数）补 vitest 用例。
