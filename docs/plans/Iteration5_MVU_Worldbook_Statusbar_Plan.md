# 迭代五规划：MVU 变量系统与世界书生成升级（借鉴 CardForge）

> 状态：**规划中，未实施**。本文档为初步规划（preliminary plan），实施前可按批次拆分执行。
> 参考来源：[SillyTavern CardForge](https://anastasia2372.github.io/sillytavern-cardforge/#/basic)（github.com/Anastasia2372/sillytavern-cardforge，v7.6.0，GPL-3.0）。
> 撰写日期：2026-09-27。

---

## 0. 合规声明

CardForge 为 GPL-3.0 项目，本项目**只借鉴其设计思路、交互流程与功能结构，不复制其任何源码**。文中涉及的 MVU 固定模板文本（变量输出格式、`[initvar]` 结构等）属于 MagVarUpdate 社区教程的公共规范文本（CardForge 自身注释亦标明「原封不动照抄教程」），引入时在代码常量处注明上游来源与版本，便于跟随 MVU 框架更新。

## 1. 背景与决策记录

本次规划基于：① 对本项目代码库的全量阅读（src/ 约 106 文件 13.6K 行 + src-tauri/ 12 命令 + docs 两文档）；② 对 CardForge 部署站点的逐页走查与其 GitHub 源码的关键文件分析（MvuEditor.vue / StatusBarEditor.vue / WorldBookEditor.vue / NovelExtractor.vue / novel-extract-*.js / card-context.js）。

已确认的决策（用户拍板）：

| 决策点 | 结论 |
|---|---|
| MVU 接入范围 | **完整套装**（变量设计器 + Zod Schema + initvar + 规则条目 + 4 正则 + 占位符 + 幂等清理） |
| 小说转世界书落点 | **引擎共用，双入口**（新 core 提取引擎；工坊 worldbook 阶段升级 + 编辑器世界书 Tab 轻量入口） |
| AI 生成状态栏 | **本期纳入**（与 MVU 变量联动；保留现有 5 套固定模板） |
| 本阶段交付物 | **仅规划文档**（即本文档），代码实施另行开工 |

## 2. 本项目现状摘要（与本次规划相关的部分）

- **卡片模型**：`src/core/card/schema.ts` zod 全量定义 chara_card_v2/v3，`extensions` passthrough 保留社区私有字段；已支持 `character_book`、`extensions.regex_scripts`、`extensions.TavernHelper_scripts`、`extensions.QuickReply`。
- **世界书**：`src/core/lorebook/convert.ts` 内嵌 ⇄ ST 全局世界书双向互转（ST 专属字段存 extensions 不丢失）；`WorldbookTab.vue` 有条目编辑 + ST JSON 互导 + 单条 AI 生成。
- **正则**：`src/core/regex/model.ts` 完整 ST 正则脚本模型（placement/markdownOnly/promptOnly/minDepth/maxDepth/trimStrings/宏展开），RegexTab 有实时测试器。
- **状态栏/美化**：`src/builtins/statusbarTemplates.ts` 5 套固定模板 + `src/services/beautifyService.ts` 「三件套」幂等插入（占位符 + 渲染正则 + 蓝灯规则条目，元数据藏 `extensions.tcsStatusbarPayload`）、变量改名重写器。
- **变量**：仅 `{{getvar::x}}` 宏引擎与 `StatusbarVariable` 轻量层；**无 MVU/stat_data/UpdateVariable 相关实现**（全仓库 MVU 一词仅出现在使用指南文案）。
- **AI**：`src/core/llm/client.ts` OpenAI 兼容客户端（SSE 流式/429 指数退避/length 续写/四级超时）；`aiService.runFieldAi(Json)` 统一入口（渠道级系统提示词 + 信号量并发 + 用量记录）；提示词库 `src/builtins/promptTemplates.ts`（target 命名空间）。
- **同人卡工坊**：9 阶段流水线（断点续跑），worldbook 阶段为「六类任务」提示词（世界观/共享背景/配角群像/剧情分段/人物列表/剧情大纲）。
- **小说解析**：`src/core/novel/source.ts` 已有中文网文章节切分、epub 解析、角色扫描、跨章等距采样。
- **测试**：vitest 141+ 用例 + Rust cargo test + 13 张真实社区卡导入回归。

## 3. 借鉴分析

### 3.1 强制学习点一：世界书生成方式

CardForge 的世界书生成是一个**三层体系**，配套一个**预算化上下文组装器**：

**① 编辑器内 AI 批量生成**（WorldBookEditor「AI 生成条目」面板）

- 输入五要素：世界观描述（必填多行）、条目类型多选（系统规则/世界设定/NPC角色/地点场景/事件规则/输出格式）、条目数量目标六级（极简 5-15 / 小型 20-35 / 中型 40-70 / 大型 80-150 / 超大型 150-300 / 极限 300-500）、描述风格四选（自动匹配/简洁命令式省 token/叙述体/YAML 结构化）、额外要求。
- **分批循环**：每批固定 30 条（保证 JSON 不截断），批数 = 目标上限/30；批次间回传**已生成条目名清单**防重复（「请生成更多未覆盖的条目，不要重复已有的」）；支持「自动继续下一批」（间隔 13 秒规避 Pro 模型 RPM 限速）或「暂停/手动续跑」；已生成 ≥ 目标下限且 ≥ 上限×0.8 时提前完成。
- **限流处理**：429 用全程共享的重试预算（3 次），等 15 秒后回退重试当前批，避免与其 LLM 客户端的请求级退避叠加。
- **System prompt 硬规则**：始终输出合法 JSON；内容全中文；**content 内引用别名/引语必须用中文引号「」『』《》，禁止英文双引号**（防 JSON 解析炸裂——这条对本项目所有 JSON 生成提示词都有普适价值）。
- **类型指导**（写进 prompt）：系统规则 constant order=1-10 before_char；世界设定 constant 或触发 order=5-20；NPC 触发 order=50-80；地点 order=30-50；事件 order=70-90；输出格式 constant order=9990-9999 after_char。
- **评审后注入**：结果先入评审表（勾选、单条重生成——保持类型定位内容重写、继续补充——允许 AI 返回空数组、禁空对象凑数），再按「**朔规则**」落卡：`insertion_order` 统一 100；蓝灯只开 `exclude_recursion`，绿灯 `prevent_recursion` + `exclude_recursion` 都开；`extensions.position` before_char→0 / after_char→1。
- **空结果防御**：归一化过滤空对象，整批空对象视为截断/偷懒并终止。

**② 参考小说素材段**：原文粘贴/导入后存卡 `extensions.cfReferenceNovel`，以「## 参考小说素材（按它的世界观、人物风格、笔法来生成 / 改写）」片段追加到**所有**生成类 prompt 尾部（批量生成/单条重生成/继续补充共用）。

**③ 小说转世界书 5 类轨迹提取**（NovelExtractor，全自动/重点扩写/IDE 引导式三模式）

- **5 类分步提取**（每类独立 AI 调用，逐片 × 逐类）：
  1. **角色**：按「5 种轨迹」输出（境界/位置/物品/关系/行为模式，每条带章节号+原文摘录）；重要角色（出场≥5章+与主角具体互动+经过事件线节点）不限量，次要角色上限 15，路人不收。
  2. **事件线**：类型仅四值（主线/支线/暗线/伏笔，禁自定义）；含起因/经过节点/结果/伏笔，主线全保留，支线暗线伏笔合计上限 10。
  3. **时间线**：按阶段切分（阶段名+章节范围+时间标记+主角境界状态）；只收含具体数字的「已发生事实距离」，不收未来预测/约定/世界观历史。
  4. **设定**：五子类（功法/丹药/地理/势力/世界观常识），严格筛选上限（功法 10/丹药 10/地理势力合计 10/常识每子系统 1 条）；功法丹药须「主角使用≥2次或主线关键道具」。
  5. **物品轨迹**：只追踪剧情关键物品；**只存获得/消耗章节，不存当前持有快照**——RP 时按当前章节 N 动态判定持有（获得≤N 且无消耗记录→持有）。action 严格三值：获得/消耗/转赠。
- **写作铁律**（所有类共用，注入 system）：绝对零度+白描（「她很温柔」✗ →「遇到受伤的小动物会带回家照顾」✓）；八股化禁令（禁「似乎/仿佛/好像」、禁「嘴角微微上扬」式微表情、禁「带着xx的口吻」、禁「不是…而是…」、禁性格标签、禁万能美人描写）；**章节号锚定**（所有事实必须标章节号，无明确标题写「未明确章节」，禁虚构）；关系/行为禁抽象标签（必须「第10章做了什么」）；事件线类型四值限定。
- **主角双模式**：`replace`（{{user}} 替代小说主角，适合穿越同人——所有「对主角的关系」改写为「对 {{user}} 的关系」，主角不单独成条目）/ `npc`（主角作为 NPC 写完整条目，{{user}} 不出现在提取结果）。
- **切片**：智能策略（识别 ≥3 个章节标题→按章分组，每片 5 章；否则字数 fallback 每片 10000 字、在句号处断），章节正则覆盖 第X章/话/节/卷、Chapter/Episode/Part/Scene、序章/尾声/Prologue 等；超 30 万字警告建议分篇章；支持「只跑前 N 片」。
- **质量闭环**：生成完一类跑一次 AI 自检（章节号锚定/标签化/八股化/万能美人四项修正）+ 可选 R2 双校验 + 跨片衔接摘要。
- **`extractionToWorldEntries` 转换（蓝绿灯自动分配）**：重要角色——多主角卡→配角绿灯 `after_char`、单主角卡→蓝灯 `before_char`；次要角色→绿灯 `after_char`；事件线——主线蓝灯 `before_char`、其余绿灯（keys=线名+经过节点关键角色前 3）；时间线→恒蓝灯；设定/物品→绿灯（keys=[名称]）。统一 `insertion_order=100`、`extensions.depth=4`、朔递归规则、`probability=100`。各类结果 YAML 序列化为条目 content。

**④ 预算化上下文组装器**（card-context.js，所有 AI 生成都附带）

- 基础字段：角色名/性格/场景/描述前 500 字/开场白前 1000 字。
- 世界书分两组：蓝灯全展（每条截 400 或 1000 字），绿灯按 **matchText 关键词命中**才塞（无 matchText 时回退前 20 条各 150 字）；总预算 12000 字符，超支即止并注明「剩余 N 条未展示」。
- 附正则/脚本清单各前 5 个（名称+模式标记）。

**本项目对照**：已有向导单条/成员条目生成与工坊六类任务；缺批量生成评审流、参考小说段、5 类轨迹、预算上下文、朔规则注入约定。

### 3.2 强制学习点二：MVU 变量系统及配套正则状态栏

CardForge 的 MVU 是**「13 件套」一键注入**：2 脚本 + 5 世界书条目 + 4 正则 + 开场白占位符（按组拆分模式下条目数 4+N）。

**2 脚本**（`extensions.TavernHelper_scripts`，需酒馆助手扩展）：

1. **MVU 变量系统**：`import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'`，挂 6 个操作按钮（重新处理变量/重新读取初始变量可见，清除旧楼层变量/快照楼层/重演楼层/重试额外模型解析隐藏）。
2. **Zod Schema**：`registerMvuSchema(Schema)`（上游 `StageDog/tavern_resource` mvu_zod.js）。生成规范：`z.coerce.number()`（禁 `z.number()`）、`.prefault()`（禁 `.default()`）、钳位用 `.transform(v => _.clamp(v, lo, hi))`（禁 `.min/.max`）、不用 `z.strict/z.passthrough`、字段名含 `.` 构建嵌套 `z.object` 树、record 优于 array。

**5 世界书条目**（统一 `extensions.position=4`（at depth）、`depth=0`、`order=200`、`prevent_recursion`+`exclude_recursion`）：

1. `[initvar]变量初始化勿开`——内容为变量初值 YAML；**条目禁用态仍被 MVU 框架读取**（这是框架约定，注释须写明「勿开」）。
2. `变量列表`——`{{format_message_variable::stat_data}}` 宏注入当前变量值给 AI；注释明确「不加 [mvu_update] 前缀！两个 AI 都需要看到」。
3. `[mvu_update]变量更新规则`——按变量组输出 `type/range/check` YAML：number 带 `type: number` + `range: 0~100`；enum 列举值；record 用 TS 风格 type 块；每个变量 `check:` 写**具体触发条件与幅度**（默认模板按类型给出：「number → update when relevant events cause this value to change, use reasonable delta」等）；`_` 前缀只读变量不列入；同类路径合并；无 description 的纯 string 多字段合并为逗号列表。
4. `[mvu_update]变量输出格式`——固定模板：`<UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable>`；JSON Patch（RFC 6902）变体五操作 `replace/delta/insert/remove/move`；`_` 开头字段只读不可更新；Analysis 中文 ≤400 字、含「时间流逝计算/是否允许剧烈更新判定/逐变量按 check 分析」三段式。
5. `[mvu_update]变量输出格式强调`——「必须插入回复末尾不可省略」一句话强化。

**4 正则**（`extensions.regex_scripts`，注入顺序：更新中→完整→只发N楼→占位符）：

1. `[美化]变量更新中`——findRegex `/<UpdateVariable>(?![\s\S]*<\/UpdateVariable>)([\s\S]*)/gs`（负向前瞻匹配**流式传输中的未闭合块**），替换为展开的 `<details>` 面板；`markdownOnly`。
2. `[美化]完整变量完成`——闭合块→折叠 `<details>`；`markdownOnly`。
3. `只发送最新N楼的变量更新`——闭合块替换为空、`promptOnly`、`minDepth = N×2`（N 默认 3，防重复更新灌爆上下文）。
4. `[不发送]界面占位符`——`/<StatusPlaceHolderImpl\s*\/>/g` 替换空、`promptOnly`（占位符只用于前端渲染定位，不发给 AI）。

**开场白**：`first_mes` 与所有 `alternate_greetings` 末尾追加 `<StatusPlaceHolderImpl/>`。

**变量设计器**（三步向导：设计→审查→注入）：

- 模型：分组（如 世界/主角/NPC）+ 字段（变量名/类型 number|string|boolean|enum|record|array/默认值/min/max/自动钳位/枚举值/record 子字段/description）；字段名用 `.` 表达嵌套路径（如 `货币.石质天元`、`装备.头部`），生成时统一构建嵌套树。
- **前缀语义**：`_` 开头=只读（AI 可见不可改）、`$` 开头=隐藏（AI 不可见）。
- 快捷预设：RPG/修仙/校园/模拟经营/恋爱/生存 一键加载 + 自定义预设保存（存 localStorage）。
- **审查步**：三产物（Zod/initvar/更新规则）实时预览 + lint 自查（`z.number()` 误用、`.default(` 误用、strict/passthrough、开了钳位没给边界、枚举缺值）。
- **注入配置**：整体注入（一条「变量列表」条目）vs **按分组拆分**（每组一条 `{{format_message_variable::stat_data.组名}}`，世界/系统/环境/主角四组恒蓝灯，其余绿灯 keys=[组名]——NPC 相关变量可按需触发省 token）；「保留最近 N 楼变量更新发回 AI」联动正则 3 的 minDepth；「在场角色追踪」开关（自动加变量+check 规则）。
- **幂等**：`mvuKeywords`/`regexKeywords` 关键词组检测已有套装→确认替换（先清理后注入）；「清空所有 MVU 条目」同时剥离开场白占位符与变量组数据。
- **持久化**：变量组定义存卡 `extensions.cfMvuVarGroups`（本项目命名 `tcsMvuVarGroups`），换机/导卡不丢设计源。

**配套正则状态栏（AI 生成）**：

- 三步流：需求描述（模式 MVU/纯文本 + 视觉风格 + 布局四式 + 额外要求）→ AI 设计变量路径清单（**数据盘点→结构规划→路径设计**三步思考法：「不要套模板，校园卡不需要 HP/MP，修仙卡的境界和灵根比 HP 重要」）→ AI 生成 HTML（评审 + 重新生成 + iframe 预览自适应高度）。
- HTML 生成要点：**完整参考模板**（`<!doctype html>` 骨架 + `populateCharacterData()` 内 `_.get(all_variables, 'stat_data.路径', 默认值)` 逐变量填充 + `eventOn(Mvu.events.VARIABLE_UPDATE_ENDED)` 自动刷新 + tab 切换逻辑），硬约束清单（可用 $/_/toastr 无需导入；禁 `//` 注释；禁 vh；禁 absolute 脱离文档流；tab 必须 `class="tab-btn"` + `data-target` 与内容 `id` 配对；必须完整 `</body></html>` 结尾）。
- **截断自动续写**：`isHtmlComplete`（闭合标签 + 每个 `data-target` 都有对应内容 div）检测，缺失时剥掉旧结尾、带末尾 400 字符上下文请求续写缺失的 tab div，最多 3 次。
- 应用（幂等）：状态栏 HTML 用 ```` ```html ```` 包裹后作为 `<StatusPlaceHolderImpl/>` 的渲染正则（`markdownOnly`），补 `[不发送]界面占位符`，确保开场白占位符，并**从变量清单反向创建/补全 MVU 套装**（已有 MVU 则只 patch initvar 合并新变量）。
- **纯文本模式**（无 MVU 备选）：AI 每次回复末尾输出 `<StatusData>字段:值</StatusData>`；渲染正则把该块替换为「HTML + 注入 `window.__statusRawText=\`$1\`` 解析脚本」；配套 `promptOnly`+`minDepth=6` 的「对AI隐藏状态数据」正则；加一条蓝灯「状态数据输出指令」条目（position=4/depth=0/order=200 同 MVU 条目配置）。
- **三方路径校验**：变量组定义 vs 状态栏 HTML 实际读取路径对比，找出漂移项（本期列为增强项，见批次 E）。

## 4. 功能更新规划（六批次）

> 落点遵循项目分层：领域逻辑进 `src/core/**`（纯 TS 可单测），AI+持久化编排进 `src/services/**`，UI 进 `src/views/**`。新命名统一用 `tcs` 前缀（对齐既有 `tcsStatusbarPayload`）。

### 批次 A：基础设施

**A1 预算化卡上下文组装器**（借鉴 3.1-④）

- 新文件 `src/core/llm/context.ts`：`buildCardContext(card, matchText?)`——基础字段截断、世界书蓝灯/绿灯分组、绿灯按 matchText 命中、总预算 12000 字符、正则/脚本清单。纯函数无 UI 依赖。
- 落点：`src/core/llm/context.ts` + `src/core/llm/context.test.ts`。
- 验收：单测覆盖预算截断顺序、绿灯命中/未命中两分支；现有 141 用例不回归。

**A2 提示词库扩容**

- `src/builtins/promptTemplates.ts` 新增 target：`worldbook:batch`（批量生成）、`worldbook:regen`（单条重生成）、`novel:extract5-*`（5 类提取 × 5 + 自检）、`mvu:varlist`（AI 变量路径设计）、`beautify:statusbar-gen`（状态栏 HTML）。统一加「中文引号」硬规则。
- 验收：模板播种幂等（builtin 行按版本刷新的既有机制生效）。

**A3 schema 增补**

- `src/core/card/schema.ts`：`extensions` 增加可选类型化字段 `tcsMvuVarGroups`（MvuVarGroup[]）与 `tcsReferenceNovel`（string）——passthrough 本就兼容旧卡，此处为编辑器读写提供类型。
- 同步检查 `tavernHelperScriptSchema` 是否支持酒馆助手 `button`（按钮组）字段，缺则补可选字段（MVU 脚本需要 6 按钮）。

### 批次 B：世界书 AI 批量生成（编辑器面板）

**B1 批处理状态机**（借鉴 3.1-①）

- 新文件 `src/core/lorebook/generate.ts`：批量参数类型（世界观/类型多选/数量六级/风格/额外要求）、prompt 组装（含防重复的已生成名单、参考小说段）、批次循环纯逻辑（每批 30、提前完成阈值、暂停/续跑 Promise 门）、结果归一化（空对象过滤）。AI 调用编排走新服务 `src/services/lorebookAiService.ts`（复用 `runFieldAiJson` + 流式 `onDelta`；批次级 429 重试预算 3 次，与客户端请求级退避不叠加）。
- **B2 UI**：`WorldbookTab.vue` 新增「AI 批量生成」折叠面板——五要素表单 + 流式预览 + 进度（第 x/y 批 · 已 N 条）+ 暂停/继续；结果评审表（勾选/类型徽标/单条重生成/继续补充/全选）；注入走朔规则（order=100、蓝灯 exclude_recursion、绿灯双开），复用 `bookEntrySchema` 构造。
- **B3 参考小说**：面板内粘贴/导入 txt（复用 `utils/file.ts`），存 `extensions.tcsReferenceNovel`，可一键清除；批量生成、单条重生成、继续补充三类 prompt 共用该段。
- 验收：目标「小型 20-35」实际产出 ≥20 条且无重名；429 模拟（mock）下自动重试并在 UI 提示；注入后条目符合朔规则（单测断言）；导出 PNG 可被 ST 正常加载（既有导入回归兜底）。

### 批次 C：小说转世界书 5 类轨迹引擎（双入口）

**C1 引擎**（借鉴 3.1-③）

- 新文件 `src/core/novel/extract5.ts`：5 类提取 prompt 常量（含白描铁律/八股化禁令/章节号锚定/筛选数字/主角双模式规则块）、`chunkNovel`（章节优先 + 字数 fallback + 句号断尾；在 `source.ts` 既有章节正则基础上增补 fallback 分组）、`emptyExtraction` 状态、`extractionToWorldEntries`（蓝绿灯自动分配 + YAML 序列化 + 朔规则 extensions）、`SELF_CHECK_PROMPT`。
- 服务编排 `src/services/novelExtractService.ts`：逐片×逐类调用 + 断点续跑（复用工坊 pipelineState 思路）+ 每类完成后的自检调用。
- **C2 工坊升级**：`NovelWorkshopView.vue` worldbook 阶段新增「5 类轨迹」模式选项（保留原「六类任务」可选），产物分别落 `pipelineState`（对齐 ROADMAP P1-1 的断点拆分方向）。
- **C3 编辑器入口**：`WorldbookTab.vue` 新增「小说提取」面板（粘贴原文 → 选主角模式/提取类型/切片参数 → 逐类提取进度 → 评审 → 注入），与批次 B 共用评审表组件。
- 验收：对指定测试小说《穿成女频男主，我天天报警.txt》完整跑通 5 类提取；多主角场景下配角条目为绿灯 `after_char`（单测）；物品轨迹不含「当前持有」字段；时间线条目恒蓝灯；章节号抽查命中率。

### 批次 D：MVU 变量系统完整套装

**D1 核心模型**（借鉴 3.2）

- 新文件 `src/core/mvu/model.ts`：`MvuVarGroup/MvuVarField` 类型（含前缀语义 `_`/`$`、六类型、钳位、record 子字段）、三生成器（`buildZodCode`/`buildInitVarYaml`/`buildUpdateRuleText`，统一 `.` 嵌套树构建）、固定模板常量（`MVU_OUTPUT_FORMAT_TEXT`/`MVU_OUTPUT_EMPHASIS_TEXT`/`MVU_VARIABLE_LIST_TEXT`，注明 MagVarUpdate 教程来源版本）、lint 自查 `mvuCheckIssues`、快捷预设数据（RPG/修仙/校园/模拟经营/恋爱/生存）。
- 新文件 `src/core/mvu/suite.ts`：`buildMvuSuite(groups, config)`——产出 2 脚本（TavernHelperScripts 形态，含 6 按钮）+ 5（或 4+N）世界书条目（position 降级 + `extensions.position=4/depth=0` 保留原值，走既有互转惯例）+ 4 正则（复用 `core/regex` 构造，`minDepth=N×2`）+ 开场白占位符追加；`detectExistingMvu(card)`/`removeExistingMvu(card)`（关键词组幂等清理）。
- 服务编排 `src/services/mvuService.ts`：`applyMvuSuite(cardId, groups, config)`（消毒 + 保存 + 快照）、`clearMvu(cardId)`。
- **D2 UI**：`EditorView.vue` 新增第 8 个 Tab「变量」（新文件 `src/views/editor/MvuTab.vue`）：三步向导（设计：分组拖拽排序 + 字段表格 + 预设加载/保存；审查：三产物预览 + lint 问题列表；完成：注入摘要 + **酒馆端前置依赖提醒**——酒馆助手/提示词模板/MVU 库）+「清空所有 MVU 条目」。
- **D3 美化联动**：`beautifyService.ts` 变量来源支持「从 MVU 变量组导入」（`tcsMvuVarGroups` → `StatusbarVariable[]`，group 字段天然对齐）。
- 验收：变量组→三产物一致性（快照单测）；重复注入不叠加（幂等单测）；清空后卡内无残留（含占位符正则剥离）；真实卡 13 件套注入后导出、在装有 MVU 的酒馆中变量正常初始化（人工真机验收项，列入 ROADMAP 已知事项）。

### 批次 E：AI 生成状态栏（美化工作台）

**E1 生成管线**（借鉴 3.2-状态栏部分）

- 新文件 `src/core/llm/htmlgen.ts`：变量路径设计 prompt（数据盘点→结构规划→路径设计三步法 + 卡上下文）、HTML 生成 prompt（完整参考模板 + 硬约束清单，按 MVU/纯文本两模式分模板）、`isHtmlComplete`（闭合 + tab 配对检测）、`continueHtml`（尾部 400 字符续写、最多 3 次）、注释清理。
- **E2 UI**：`BeautifyView.vue` 新增「AI 生成」模式（与现有模板模式并列）：三步（需求→变量清单评审→HTML 预览）；iframe 预览复用 `HtmlPreview.vue`；生成结果可「沉淀为模板」（复用模板中心反沉淀机制）。
- **E3 应用**：复用 `beautifyService.insertStatusbar` 幂等插入；MVU 模式下确认占位符正则/开场白占位符（与批次 D 套装互补去重）；纯文本模式落「渲染正则 + 隐藏正则（minDepth=6）+ 输出指令蓝灯条目」三件。
- **E4 三方路径校验**（增强项，可后置）：扫描 HTML 中 `_.get(all_variables, 'stat_data.xxx')` 实际路径 vs `tcsMvuVarGroups` 定义，WorldbookTab/变量 Tab 展示漂移清单。
- 验收：「校园日常卡」需求生成的变量清单不含 HP/MP（提示词有效性人工评审）；构造截断样本续写后 tab 配对完整（单测）；现有 5 套模板插入流程不回归。

### 批次 F：文档与测试

- `docs/ARCHITECTURE.md` 增补新模块（mvu/extract5/context/htmlgen/lorebook generate）；`docs/ROADMAP.md` 勾销对应项（P2-3 beautify:trio 由批次 E 覆盖；P1-1 工坊断点由批次 C2 部分覆盖）并增补「MVU 真机验收」已知事项。
- 测试增量 ≥30 用例：mvu 三生成器快照、suite 幂等/清理、extract5 蓝绿灯分配与 YAML、context 预算、htmlgen 完整性检测、generate.ts 批次循环（mock AI）。

### 依赖关系与建议顺序

```
A（基础设施）
├── B 世界书批量生成 ──┐
├── C 小说5类提取（双入口）
└── D MVU 套装 ──→ E AI 状态栏（MVU 模式依赖 D；纯文本模式可先行）
F 文档测试随各批次同步
```

建议实施顺序：A → D → E → B → C（先打通 MVU 主线，世界书两批次共享 A 的 context 与评审组件）。

## 5. 本期非目标（CardForge 有但不引入）

EJS 模板编辑器、酒馆助手脚本 AI 全自动生成、独立 NPC 生成器页、状态栏沙盒、Live2D AI 助手、多服务商（Claude/Gemini 原生）接入、自动更新器。其中 EJS/沙盒可视后续迭代评估。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| GPL 合规 | 不复制源码；MVU 固定模板文本注明 MagVarUpdate 教程来源，作为社区规范常量维护 |
| MVU 套装依赖酒馆端三插件 | 注入完成页明确前置清单；真机验收列入 ROADMAP 已知事项 |
| 双层 429 退避叠加（客户端请求级 + 批处理批次级） | 批处理层仅做批次级共享预算（3 次/15s），单请求退避保持客户端现状 |
| 超大世界书（300-500 条）的编辑器渲染性能 | 评审表用 naive-ui 虚拟列表；批量注入一次性写库（对齐既有「响应式消毒」约定） |
| AI 生成的 YAML/JSON 引号炸裂 | 全线提示词加中文引号硬规则；`extract.ts` 的 JSON 抽取已有容错，批次 A 复核覆盖 YAML 场景 |
| 上下文超预算导致生成质量下降 | buildCardContext 硬预算 + 分批防重复名单只传条目名不传全文 |

## 7. 与既有文档的关系

- 本文档入 `docs/plans/`（新建目录，存放「规划中」文档）；实施完成后按 623b6c2 惯例将已实现内容并入 `docs/ARCHITECTURE.md`、未完成项并入 `docs/ROADMAP.md`，再归档本文档。
- 折叠的 ROADMAP 条目：P1-1（工坊断点，C2 部分覆盖）、P2-3（beautify:trio，E 覆盖）；新增条目：MVU 真机验收、三方路径校验（若 E4 后置）。
