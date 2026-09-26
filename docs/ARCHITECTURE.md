# TavernCard Studio 架构与功能说明

> 本地桌面端 SillyTavern 角色卡工作站：转换、卡库、编辑、模板美化、AI 辅助生成、诊断修复、同人卡工坊。
> 功能蓝本参考 **piney**（工作站形态、PNG 编解码、美化三件套、卡医），流水线与提示词体系参考 **Novalcard**（小说→成卡全流程）；
> 迭代五/六借鉴 **CardForge**（GPL-3.0）的方法论：MVU 变量系统、世界书批量生成、小说 5 类轨迹提取、AI 状态栏生成、点选定向改——**仅借鉴设计与社区规范文本（MagVarUpdate 教程），不复制 GPL 源码**。
> 本文描述**实际实现的架构与功能**；待改进事项见 [ROADMAP.md](./ROADMAP.md)。

## 技术栈

Vue 3 `<script setup>` + TypeScript + Naive UI + Pinia + Vue Router（hash 模式） + CodeMirror 6 + zod + JSZip + js-tiktoken（lite + ranks 按需 chunk） + vue-i18n@10（locale 懒加载） + @vueuse/core（虚拟列表/视口） + @medv/finder（点选选择器生成） + vitest + @vue/test-utils + happy-dom + @playwright/test（E2E，connectOverCDP）；桌面端 Tauri 2（Rust：tauri-plugin-sql/dialog/fs、reqwest 共享连接池、tokio、futures）。

分层原则：**领域逻辑纯 TS 无 UI 依赖 → 服务层编排持久化与 AI → 视图层只做交互**。依赖单向向下，同层禁止互引。

```
┌─ views/ (Vue3 + NaiveUI)        交互与呈现，不含业务规则
│   ├─ editor/                    编辑器八个 Tab（基础/描述开场白/世界书/角色成员/正则/脚本/变量 MVU/扩展）
│   └─ PreviewView                卡片市场式只读预览（/preview/:id）
├─ components/                    跨页面复用组件（CardCover/FieldAiButton/CodeEditor/HtmlPreview/ImportOptionsModal 等）
├─ composables/                   快捷键注册表 useShortcuts、命令面板、卡历史
├─ stores/ (Pinia)                跨页面共享状态（workspace 卡列表/渠道、appearance 主题字体）
├─ services/                      业务编排：导入去重、版本快照、AI 用量、三件套、MVU 套装、世界书批量、小说提取、导出、诊断、流水线、备份、最近转换
├─ i18n/ + locales/               vue-i18n 骨架（zh-CN/en-US locale 懒加载独立 chunk，通用层先行）
├─ db/                            存储抽象（Memory / IndexedDB / Tauri SQLite；list/get + listPage keyset 分页）
├─ builtins/                      内置模板资产（首启播种，按 id 增量补种 + builtin 行随版本刷新）
├─ core/                          纯函数领域库（全部可单测，无任何框架依赖）
└─ src-tauri/                     Rust 命令（commands/{db,http,fonts,llm,export,net}）
```

## 功能地图（12 视图）

| 页面 | 路由 | 能力 |
|---|---|---|
| 卡库 | `/library` | 分类树/标签筛选/搜索、批量导出 JSON·PNG（封面作底图、**文件名模板**）、回收站、两卡对比入口；**单击选中/双击进预览**、**F2 重命名 / Delete 回收 / ↑↓ 导航 / Enter 预览**；**导入选项（世界书/正则拆分 + 预设）**；**>500 张行虚拟化** |
| 卡片预览 | `/preview/:id` | **只读市场式预览**：封面大图、宏替换开场白渲染（美化占位符徽标）、世界书蓝绿灯折叠、正则/脚本清单、token 概览；右上「编辑」进编辑器 |
| 生成向导 | `/wizard` | 选模板 → 基础设定（AI 扩写）→ 字段工作台（全部字段常驻手填 + AI 生成可选 + 自定义字段 + 角色成员清单）→ 入库 |
| 转换工具 | `/converter` | PNG⇄JSON（ST tEXt 对齐：ccv3 优先 chara 回退，双写可选）、批量 zip、底图显式选择、完整性报告、**最近转换记录（≤50 条元数据，≤2MB 保留产物可重新下载）** |
| 美化工作台 | `/beautify` | 两种模式：**模板模式**（五套模板 + 变量工作台 + 三件套一键插入）；**AI 生成模式**（需求 → AI 变量路径设计 → AI HTML 生成含截断自动续写 → **元素点选定向改** → 应用/沉淀为模板；MVU/纯文本双模式） |
| 模板中心 | `/templates` | 四类模板（card/statusbar/regex/prompt）结构化编辑（builtin 自动落副本）、从卡沉淀（字段/正则勾选/状态栏元数据）、导入导出 |
| AI 中心 | `/ai` | 多渠道管理（OpenAI 兼容/NovelAI）、测连（最小 chat POST）、拉模型、生图测试、用量记录 |
| 诊断与调整 | `/diagnosis` | 静态体检 + 卡医 LLM 诊断 + 处方 diff 应用 |
| 同人卡工坊 | `/novel` | txt/epub 导入 → 章节切分 → 角色扫描 → **抽卡与世界书两步独立重跑**（世界书支持六类任务 / **5 类轨迹**两种模式）→ 开场白/文风/user 人设 |
| 统计看板 | `/stats` | 卡库规模、token 分布、AI 用量 |
| 设置与备份 | `/settings` | 主题/字体、导出文件夹、**导出文件名模板（{name}/{spec}/{version}/{date}）**、**界面语言切换**、**快捷键只读表**、全量备份 zip、偏好 |
| 使用指南 | `/guide` | 小白向说明（目录常驻 sticky） |

全局：Ctrl+K 命令面板（页面跳转/最近卡/新建/导入/切主题）、五套主题 + 自定义、UI 字体在线安装、**MVU 变量系统 13 件套**（编辑器「变量」Tab）。

## core 各模块职责与关键决策

### card（schema / normalize / hash / exportName / importOptions）
- zod 定义 V2/V3 全字段；`passthrough` 保留社区卡私有扩展。
- `parseLooseCard`：data 块优先，无 data 时从 V1 顶层合成；tags 兼容数组/逗号串；顶层冗余字段 data 优先。
- **社区卡宽容化（真实 13 卡回归验证）**：世界书条目布尔扩展字段（delay_until_recursion 等）宽容 0/1 数字；`comment` 数组/数字收敛为字符串；`data.extensions.tavern_helper` 允许数组形态透传；`regex_scripts`/`TavernHelper_scripts`/`QuickReply`/条目 `id` 缺失时按序号确定性兜底（随机 id 破坏 dataHash 去重）。
- extensions 类型化扩展字段：`tcsMvuVarGroups`（MVU 变量组持久化）、`tcsReferenceNovel`（参考小说素材）、TavernHelper 脚本 `button` 按钮组（MVU 脚本 6 按钮）。
- 导出时补齐顶层冗余（name/description/... + creatorcomment/avatar/talkativeness/fav/create_date）。
- `dataHash`：FNV-1a 双轮 64bit，仅对影响行为的 15 个字段计算，稳定字符串化（键排序）。用于导入去重与"有无实质修改"判断。
- `exportName.ts`：导出文件名模板渲染（`{name}/{spec}/{version}/{date}`，空名回退 untitled、超长截断；Windows 非法字符最终由 Rust `safe_export_file_name` 二次清洗）。
- `importOptions.ts`：导入拆分选项（世界书拆 ST 全局世界书 JSON 复用 characterBookToWorldInfo；正则拆独立脚本库 JSON）——默认 embed 与既有导入行为完全一致。

### png（codec）
- 手写 PNG 解析：签名校验 → chunk 遍历（长度/CRC 校验）→ tEXt 编解码（keyword Latin-1 + \0 + UTF-8 文本）。
- 读取顺序对齐 ST：ccv3 优先，chara 回退；base64 → UTF-8 JSON；宽容处理 data: 前缀、URL 编码、明文 JSON。
- 写入：移除旧 chara/ccv3 块后插到 IEND 前；默认双写（设置可关）。
- `makePlaceholderPng`：手写 zlib stored 块 + adler32，无底图导出用。

### lorebook（convert / generate）
- 嵌套 ⇄ 扁平双射。ST 专属字段（probability/depth/selectiveLogic/group/递归控制/role/vectorized…）以 extensions 为真值载体：嵌入→全局时读 extensions 覆盖默认，全局→嵌入时全部写回 extensions。
- 高级位置（AN/EM/atDepth 等）在嵌入卡中只能表达 before/after，原始数值保留在 extensions.position。
- `generate.ts`（迭代五）：世界书 AI 批量生成纯逻辑——每批 30 条防 JSON 截断、批间回传已生成名单防重复、提前完成阈值（≥下限且 ≥上限×0.8）、结果归一化（空对象过滤、整批空视为截断）、**朔规则落卡**（order=100、蓝灯 exclude_recursion、绿灯 prevent+exclude 双开）、中文引号硬规则（防 JSON 解析炸裂）。

### llm（client / extract / image / tauriStream / context / htmlgen）
- `LlmClient(config, fetchImpl)`：fetchImpl 注入点；桌面端经 `fetchImplForPlatform()` 自动注入 Rust 流式代理。
- **超时四级**：连接 15s（流式响应头等待）/ 首 token 60s / 流式空闲 60s（已产出内容后空闲超时不可重试，防 onDelta 重放重复计费——ADR 结论固化在 client.ts 注释）/ 非流式整体 300s（测连 30s）。
- **错误体识别**（`inspectLlmErrorBody`）：HTTP 200 但非 OpenAI 形状（旧网关 `{code,msg}`、`success:false`、`error{}`）→ 抛带服务端 msg 的 LlmError；code 0/200/OK 视为成功码不当错误文案。
- SSE 手写解析：跨 chunk 截断行、CRLF、结尾无换行的残留行冲刷、流中 `error` 字段抛出；空文本收尾报错而非静默。
- 429/5xx 指数退避（上限 15s，退避后检查取消）；finish_reason=length 续写（流式/非流式两路径，续写带前文 assistant 消息）。
- `tauriStream.ts`：Tauri Channel 事件（headers→chunk*→done|error，camelCase 契约有 Rust 序列化单测锚点；Rust 侧 ~16ms 攒批合并 Chunk 帧）合成 ReadableStream Response；透传 method/headers/signal（建连期 abort → llm_cancel_stream 断连；响应开始后走 reader.cancel → cancel 命令）。单测覆盖 error 先于 headers、done 收束、两种取消路径、invoke 失败。
- `extractJson`：剥思考标签 → 代码块 → 平衡扫描（字符串内括号免疫）→ 尾逗号修复。
- 生图：OpenAI images/generations（b64/url 双兼容）+ NovelAI 原生（zip 内 png，JSZip 解）。
- `context.ts`（迭代五 A1）：**预算化卡上下文组装器**——基础字段截断（描述 500/开场白 1000）+ 世界书蓝灯全展（截 1000）绿灯按 matchText 关键词命中（无命中文本回退前 20 条各 150）+ 总预算 12000 字符超支即止并注明剩余未展示 + 正则/脚本清单前 5。所有生成类 prompt 共用。
- `htmlgen.ts`（迭代五 E）：**AI 状态栏生成管线**——① 变量路径设计 prompt（数据盘点→结构规划→路径设计三步法，「不要套模板」原则）；② HTML 生成 prompt（完整参考模板 + 硬约束清单：禁 // 注释/vh/absolute、tab-btn 与 data-target 配对、完整 </body></html> 结尾）与纯文本模式 prompt（<StatusData> 标签 + `window.__statusRawText` 解析）；③ `isHtmlComplete` 完整性检测（闭合标签 + tab 配对）+ 截断自动续写（尾部 400 字符上下文，最多 3 次）+ body 内注释清理；④ 应用产物构造（MVU 渲染正则 / 纯文本 2 正则 + 指令条目）；⑤ `checkPathDrift` 三方路径校验（变量组定义 vs HTML 中 `stat_data.` 实际路径，双向漂移清单）。

### theme / font（外观体系，纯数据）
- 主题：色板 + 明暗模式 + 可选 SVG 纹理（inline data URL）→ CSS 变量（`--tcs-*`）；内置 5 套。
- 字体目录：霞鹜文楷/思源宋体/朱雀仿宋/汇文明朝体/悠哉字体（均 SIL OFL）元数据。

### stats（tokens）
- 分类四桶（spec 宏与标签 / 词边界 / 其他=CJK 逐字）对齐 piney 口径。
- 超 8K 字符片段走 CJK+长度粗估——BPE 对超长重复串是性能悬崖（真实事故：500KB base64 图统计卡死）。
- **按需加载（P1-3）**：cl100k ranks（约 5.6MB）经动态 `import('js-tiktoken/ranks/cl100k_base')` 独立 chunk + promise 单例，不再拖慢首屏；`countTokens` 同步签名不变——词表就绪前 CJK 粗估并标 `estimated: true`（UI 显示 `~` 前缀），就绪后无感替换精确值（TokenBadge onMounted warmUp 后重算）。

### novel（source / extract5）
- 章节头正则覆盖中文网文惯例（第X章/回/节/卷/幕/折/话、楔子/序章/番外/Chapter N）；无头时按长度均分并在换行处断开。
- epub：container.xml → opf → manifest/spine 顺序 → xhtml 轻量正文提取（环境无关，Node 可测）。
- 角色扫描：贪心 2-4 字词频 + **边缀折叠**——中文人名总在词块边缘（"沈舟看着"→"沈舟"），长词被高边缀支持时判定为"名+谓语粘连"丢弃；仅边缀出现的名字也参与评分。
- 上下文检索：命中段落收集（每章上限）→ 超总量时跨章等距采样。
- **extract5.ts（迭代五 C，小说转世界书 5 类轨迹引擎）**：每类独立 AI 提取——角色（境界/位置/物品/关系/行为模式 5 轨迹；重要角色不限量、次要 ≤15、路人不收）、事件线（主线/支线/暗线/伏笔四值，支线+暗线+伏笔合计 ≤10）、时间线（只收含具体数字的已发生事实距离）、设定（功法/丹药/地理/势力/常识，严格上限）、物品轨迹（**只存获得/消耗章节，不存当前持有快照**——RP 时按章节 N 动态判定持有）。写作铁律注入 system（白描/八股化禁令/章节号锚定/关系行为禁抽象标签/事件线四值/中文引号）；主角双模式（replace：{{user}} 替代主角，npc：主角作为 NPC 完整成条目）。`chunkNovel`：章节优先（≥3 章按每片 N 章分组），字数回退（句号断尾）。`normalizeExtractionArray` 归一化（枚举收敛、空对象过滤）。`extractionToWorldEntries`：**蓝绿灯自动分配**（单主角卡重要角色蓝灯 before_char / 多主角卡配角绿灯 after_char、次要角色绿灯、主线蓝灯其余绿灯 keys=线名+关键角色前3、时间线恒蓝灯、设定物品绿灯 keys=[名称]）+ 朔递归规则 + YAML 序列化（全中文引号）。

### mvu（model / suite，迭代五 D）
- `model.ts`：变量设计器核心——`MvuVarGroup/MvuVarField` 模型（前缀语义：`_` 只读 AI 不可改、`$` 隐藏 AI 不可见；字段名 `.` 表达嵌套路径构建嵌套树）；三产物生成器 `buildZodCode`（z.coerce.number/.prefault/.transform clamp，禁 z.number/.default/.min/.max/strict/passthrough——MVU 框架约束）、`buildInitVarYaml`（[initvar] 初值）、`buildUpdateRuleText`（type/range/check 结构、`_` 只读不列、同类路径合并、无 description 纯 string 合并逗号列表）；lint 自查 `mvuCheckIssues`；六快捷预设（RPG/修仙/校园/模拟经营/恋爱/生存）；固定模板文本（变量输出格式 `<UpdateVariable><Analysis/><JSONPatch/>`（replace/delta/insert/remove/move 变体）、输出格式强调、变量列表宏——MagVarUpdate 教程社区规范文本，注明来源维护）。
- `suite.ts`：**13 件套一键注入**——2 TavernHelper 脚本（bundle.js 导入含 6 按钮组 + Zod Schema）+ 5（或 4+N 按组拆分：世界/系统/环境/主角恒蓝灯其余绿灯 keys=[组名]）世界书条目（统一 extensions.position=4/depth=0/order=200/双禁递归；[initvar] 禁用态仍被框架读取）+ 4 正则（更新中负向前瞻匹配流式未闭合块→展开面板 / 完整→折叠面板 / 只发最新 N 楼 promptOnly minDepth=N×2 / 界面占位符不发送）+ 开场白占位符 `<StatusPlaceHolderImpl/>`。全部幂等：`detectExistingMvu`/`removeExistingMvu` 关键词组清理后注入，重复执行不叠加；变量组定义持久化 `extensions.tcsMvuVarGroups`。

### css（locate / pickerScript，迭代六 B2）
- `locate.ts`：CSS 文本规则块定位——栈式扫描 `selector{body}` 区间（注释/字符串感知、@media 嵌套），选择器归一化匹配（大小写/空白/伪类剥离）；未命中降级为「末尾追加覆盖规则」建议而非报错。
- `pickerScript.ts`：iframe 内点选脚本模板——@medv/finder 以 `String(finder)` 序列化嵌入（零依赖自包含），mouseover 高亮（临时 outline 不污染模板样式）、click 拦截生成最短唯一选择器、postMessage 回父页、Esc 退出。

### diag（staticChecks）
- 本地零成本检查：结构缺失（error）/ token 超限（分级）/ 世界书键冲突与死条目 / 正则语法 / base64 嵌图体积 / 宏使用建议。
- 阈值可调，供 UI 与卡医 skill 复用。

## db：三驱动等价性

| 驱动 | 场景 | 行为 |
|---|---|---|
| MemoryStore | vitest | Map 表，`setStore()` 注入 |
| IndexedDbStore | 浏览器/dev | 每表一个 objectStore，行 = `{id, value}` |
| TauriSqlStore | 桌面 | `window.__TAURI__.core.invoke('plugin:sql|…')`，每表 `CREATE TABLE (id TEXT PRIMARY KEY, json TEXT)`，UPSERT |

选择逻辑：`isTauri()` → SQLite（**并发安全**：进程内单 promise，瞬时失败自动重试一次，仍失败降级 IndexedDB 并产生一次性提示；意外 reject 时清空缓存 promise 允许重试）；无 indexedDB 全局则 Memory。业务代码只面对 `DataStore` 接口（get/list/listPage/put/bulkPut/delete/clear/dump）。

**`listPage` keyset 分页**（P3-4 大规模卡库）：按 id 升序取一页（cursor=上页末位 id，nextCursor=null 到底）。SQLite `WHERE id > ? ORDER BY id LIMIT ?` 下推、IndexedDB IDBCursor、Memory 切片——三驱动等价性有单测。只作用于展示路径（`cardService.listCardsPaged`），导入/去重仍走 list 全量。

## services 关键流程

### 导入（importCardFromJson / importCardFromPng）
```
原始 JSON/PNG bytes
  → parseLooseCard 归一化（可选 convertSpec）
  → dataHash 与现有卡比对（软删除除外）
     ├─ 命中：覆盖该行（replacedName 提示）
     └─ 未命中：新建行（含 tokenStats 全量统计）
  → addVersion('导入') 初始快照
  → PNG 导入附底图 dataURL 封面（CardRow.cover）
```

### 卡封面（CardRow.cover）
- data URL 形态随 cards 表行存储；PNG 导入自动附封面；编辑器头部可设置/更换/移除（`utils/image.ts` 选图经 canvas 等比缩放 ≤512px，PNG 保透明其余 JPEG）。
- 卡库导出 PNG 自动用封面作底图（`dataUrlToBytes` 解码传入 `cardToPngBytes`）；无封面用占位图。

### 保存（saveCard）
响应式消毒（JSON 往返剥 Proxy）→ toRow 重算 hash/tokens → put → hash 变化则 addVersion（版本上限 50，超出删最老）。`keepCover` 保封面。

### 美化三件套（beautifyService）
1. first_mes/description 尾部插占位 tag（已存在则跳过）
2. extensions.regex_scripts 注册/替换渲染脚本（findRegex=tag，replaceString=变量已替换的 HTML，`$`→`$$`、换行→`\n` 转义；脚本挂 `extensions.tcsStatusbarPayload` 元数据供模板中心反沉淀）
3. character_book 追加规则条目（蓝灯 constant，含变量清单——按 group 分组列出；条目 id 取卡内 max+1；同样挂元数据）
幂等：重复插入不叠加（tag 存在检测 + 正则 normalize 匹配 + 条目备注去重）。
**变量改名重写器**（`renameStatusbarVariable`）：html/css/js/世界书说明/previewMock 全量重写（getvar 占位 + 词边界），variables/previewMock 同步迁移；六维模板 JS 的属性键表渲染时按 variables 注入（`__TCS_STAT_KEYS__` 占位），改名无需改 JS。
**AI 状态栏产物**（迭代五 E3）：`buildMvuStatusbarArtifacts`（HTML ```html 围栏作为 `<StatusPlaceHolderImpl/>` 渲染正则 markdownOnly）与 `buildTextStatusbarArtifacts`（<StatusData> 渲染正则 + 对 AI 隐藏正则 promptOnly minDepth=6 + 蓝灯输出指令条目 position=4/depth=0/order=200）；`applyAiStatusbarArtifacts` 按脚本名/条目名幂等写入并确保开场白占位符。

### MVU 套装（mvuService，迭代五 D）
`applyMvuSuite(cardId, groups, config)`：消毒 → `applyMvuToCard`（幂等清理后注入 13 件套）→ 保存 + 强制快照；`clearMvu` 全量清空（条目/脚本/正则/占位符/变量组）；`hasMvu` 供 UI「替换」提示。核心构建在 core/mvu（纯函数），本层只管持久化与快照。

### 世界书 AI 批量生成（lorebookAiService，迭代五 B）
批次循环编排：每批 30 → `runFieldAiJson`（流式 onDelta）→ 归一化防重 → 评审表。**批次级共享重试预算**（默认 3 次，失败等 15s 重试当前批——客户端请求级退避耗尽后才到这，两层不叠加）；暂停/续跑为 Promise 门（gate），AbortSignal 随时终止。参考小说素材存 `extensions.tcsReferenceNovel`，批量/单条重生成/继续补充三类 prompt 共用。

### 小说 5 类轨迹提取（novelExtractService，迭代五 C）
`ExtractState`（config + 分片缓存 + extraction + doneKeys）由调用方持有，按 `(chunkIndex:type)` 粒度断点续跑；逐片×逐类调用（同类已提取名单作为防重复摘要传入）；每类完成后可选 AI 自检修正（失败不致命保持原结果）。工坊 worldbook 阶段与编辑器「小说提取」面板共用。

### 最近转换（converterService，P1-4）
元数据落 settings（`pushRecent` 上限 50 淘汰最老、同 id 幂等）；≤2MB 产物留进程内缓存（会话级）供「重新下载」，>2MB 只记元数据并禁用下载入口。

### 快捷键（useShortcuts，P2-4）
表格式注册 `{ id, combo, scope, description, handler }` 全局单例 registry（同 scope+combo 冲突 console.warn）；LayoutView 挂统一 keydown 捕获层——**输入框聚焦时带修饰键的组合仍生效（Ctrl+K），纯按键（F2/Delete/方向键）不触发**；scope 匹配优先当前页面（`data-shortcut-scope` 标记）回退 global；设置页只读表格与注册表同源。

### 模板中心（templateService）
- 内置模板播种：按 id 增量补种 + **builtin 行随版本刷新**（payload/名称/描述与代码定义不一致时覆盖，createdAt 保留）——保证老库能拿到新版内置模板；用户修改 builtin 走副本语义，覆盖安全。
- 备份 wipe 导入清空 templates 表后 `resetSeededFlag()` 允许进程内重新补种。
- 结构化编辑：四类模板按 kind 出表单；builtin 编辑时自动 clone 落副本，取消自动清理副本。
- 从卡沉淀：字段（始终保留 description/first_mes 槽位）+ 正则脚本勾选逐条 + 状态栏元数据（正则脚本或世界书条目 extensions 读回）。

### 导出（exportService + Rust export 命令）
- 全局导出目录：默认 exe 同级 `data/exports/`（Rust `export_dir`，失败回退 AppData），settings `export_dir` 可覆盖；设置页选择（Rust 侧 tauri-plugin-dialog blocking 选框）/打开/恢复默认。
- `saveExportFile`：桌面端 base64 经 `write_export` 落盘（文件名清洗拒路径分隔/Windows 保留名，允许中文）返回完整路径；浏览器回退 `<a download>`。
- 全部导出出口（转换工具/卡库/模板/备份/世界书）统一走 `backupService.downloadBlob/downloadText`（async，透传路径给 toast）。

### 同人工坊流水线（projectService + NovelWorkshopView）
阶段机：chapters → scan → select → context → **extract（基础卡）→ worldbook（世界书，独立重跑）** → style/greeting → persona → done。
每步 `updateProject` 深拷贝改写落库（断点续跑）；LLM 步骤消费内置提示词（Novalcard 体系移植），全书分析按 10 章分块增量拼接。
**抽卡/世界书两步拆分（P1-1）**：基础卡落 `pipelineState.extractedCard`、世界书条目独立落 `pipelineState.worldbookEntries`（含模式标记 six/traj5）——世界书失败只重跑本步不影响已抽取的卡；重跑抽取步会回填既有世界书条目。世界书步两种模式：六类任务（一次成书）与 **5 类轨迹**（core/novel/extract5 引擎逐片×逐类，蓝绿灯自动分配）。

### 诊断（diagService）
静态检查即时执行；卡医 = skill（systemPrompt+steps+outputSchema）+ 静态检查摘要 + 卡全文（base64 脱脂、60K 截断）→ 结构化报告；处方经 patch JSON → diff 预览 → applyPatch 保存（自动快照可回滚）。

### AI 服务（aiService）
- 渠道管理（同 kind 激活互斥）、`makeLlmClient` 按平台注入 fetch、并发信号量（默认 2 渠道级可配）、渠道全局系统提示词自动前插、用量日志。
- 向导成员条目：`runFieldAiJson` 批量生成 → 按 comment 匹配回填 → 主角 constant/配角触发词写 `character_book.entries`。

## Tauri 命令清单（src-tauri/src/commands/）

| 命令 | 模块 | 说明 |
|---|---|---|
| `db_url` | db.rs | SQLite 连接串（便携优先 exe 同级 data/studio.db） |
| `http_get_bytes` | http.rs | 二进制直连下载（绕 webview CORS，300MB 上限；共享连接池 + 请求级 300s 超时） |
| `font_dir` / `font_write` / `font_read` / `font_exists` / `font_delete` | fonts.rs | 字体文件落盘管理（base64 IPC + 文件名白名单；`font_exists` try_exists+元数据轻量校验，不再为验可读性全量读文件） |
| `llm_post_stream` / `llm_cancel_stream` | llm.rs | LLM 流式代理（Channel 事件回传，**~16ms 攒批合并 Chunk 帧**，会话注册表 + 建连期可取消 + 32MB body 上限 + https/回环 URL 校验） |
| `export_dir` / `pick_export_dir` / `write_export` / `open_dir` | export.rs | 全局导出目录（文件夹选择/落盘/打开） |

`commands/net.rs`：`OnceLock<reqwest::Client>` 全局共享连接池（connect_timeout 15s）——http.rs/llm.rs 共用，同渠道连续对话不再逐请求重建 Client 重复 TLS 握手；请求级超时挂 `.timeout()` 互不冲突。

## 视图层约定

- 路由 hash 模式（file:// 与 Tauri 协议下可用）。
- naive-ui `NGrid` 的直接子元素只能是 `NGi`，其余组件会被静默丢弃不渲染（真实事故：诊断页明细面板空白）；单卡片布局直接用 NCard。
- **NInput 的 `@change` 在实际输入路径不可靠**（composition/change 事件链路问题）：需要失焦提交的输入用原生 `<input>` + 原生 `change` 事件（变量工作台 key 编辑即此实现）。
- **Vue reactive proxy 不能 structuredClone**（DataCloneError）：深拷贝一律 `JSON.parse(JSON.stringify())`（BeautifyView 工作副本、saveCard 消毒均如此）。
- **布局滚动几何**：两级 n-layout 各自渲染 `.n-layout-scroll-container` 且都参与滚动（页头会滚走、NLayoutContent 被内容撑高使 sticky 失效）。App.vue 已修复：两级 scroll-container 均不滚动、内层列布局，NLayoutContent 内部 `.n-scrollbar-container` 成为唯一受限视口——所有页面 `position: sticky`（指南目录/卡库分类栏）随之生效。
- **主题切换统一渐变**：body 与主要面板/容器清单 `.25s` 同节奏（`!important` 压过 naive 动态注入）；收窄清单不用 `*` 通配。
- 编辑器视图持有卡的深拷贝本地态，`markDirty` 跟踪，保存走 saveCard；路由 `:id` 变化时必须重载（组件复用），否则保存会写入错误的卡。
- 本地撤销栈在撤销/重做前必须 flush 待提交的节流快照，否则最近 500ms 内的编辑丢失。
- iframe 预览 `sandbox="allow-same-origin"`（不执行脚本优先安全）；`allowScripts` 开启脚本执行（AI 状态栏 tab 切换预览），`enablePicker` 再注入点选脚本（@medv/finder + postMessage 桥，Esc 退出）。HtmlPreview 缺省跟随全局明暗。
- CodeMirror 6 轻封装 + One Dark（深色）/ 纸面（浅色，颜色引用 `--tcs-*`）双主题，经 Compartment 随全局主题热切换；`highlightLine` prop 支持外部定位（点选定向改：滚动选中规则块所在行）。
- **i18n 骨架**：vue-i18n composition + locale 懒加载独立 chunk；首期只抽通用层（导航/命令分组/FieldAiButton），视图深层文案渐进迁移；`settings.ui_language` + localStorage 双持久化；naive-ui locale/dateLocale 跟随。
- 测试对样例文件（本机社区卡/小说样本）用 `existsSync` 短路 + `describe.skipIf`，样本缺失自动整组跳过且收集期不崩。

## 主题与界面字体

- **主题**（core/theme，纯数据）：每套主题 = 色板（映射为 `--tcs-*` CSS 变量）+ 明暗模式 + 可选 SVG 纹理（inline data URL，≤14% 不透明度）。内置 5 套：暗夜·幽紫（默认）/ 晨白 / 书卷·纸墨 / 竹林·青韵 / 墨海·黛蓝。
- stores/appearance 统一驱动：naive 基础主题（dark/light）+ GlobalThemeOverrides 色板 + documentElement CSS 变量；偏好持久化 settings 表 + localStorage 双写（首帧同步读 localStorage 防主题闪烁）。init 拆步独立容错（主题偏好/字体列表/字体恢复互不拖垮）；已安装但文件缺失的字体标记 `missingFontIds` 并提供重装指引。
- **视图层禁止硬编码主题色**，一律使用语义变量（`--tcs-accent` / `--tcs-border` / `--tcs-fill` / `--tcs-good` 等，带旧值兜底）。
- naive 会注入 `body { font-family: 默认token }`（cssr 全局规则，**不吃 overrides**），界面字体用 `--tcs-font-ui` + 同选择器 `!important` 接管；组件均从 body 继承。
- **字体**（services/fontService）：内置目录 → 下载（桌面端走 `http_get_bytes`；浏览器 fetch 受 CORS 限制，Releases 最终下载域无跨域头，仅 raw 仓库文件类可用）→ zip 经 JSZip 解包 → FontFace 注册。存储双模式：桌面端文件落盘 `data/fonts/`（`font_dir/font_write/font_read/font_delete`，base64 传参 + 文件名白名单校验），fonts 表只存元信息；浏览器端字节存 `font_blobs`（IndexedDB）。字体不进备份（体积大且可重下）；本地导入（ttf/otf/woff）任意环境可用；桌面端读到缺 fileName 的旧元信息时从 font_blobs 自愈迁移；`listInstalled` 瞬时失败自动重试一次（启动竞态自愈），设置页挂载时主动刷新兜底。

## 测试策略

- vitest 238 用例（31 文件）：core 单测为主力（编解码往返、迁移矩阵、互转语义、mock fetch 的重试/续写/SSE/超时/错误体、epub 构造、扫描折叠、静态检查；迭代五/六新增：MVU 三产物与套装幂等、批量生成批处理纯逻辑、5 类提取切片/归一化/蓝绿灯分配、AI 状态栏完整性检测与续写、卡上下文预算、CSS 规则定位、导出文件名模板、导入拆分、最近转换上限/阈值、listPage 分页等）；services 集成用 MemoryStore 全链路（导入去重/快照回滚/备份恢复/三件套幂等/改名重写器/模板播种刷新/AI 状态栏产物）；组件测试（@vue/test-utils + happy-dom：TokenBadge estimated 标记与阈值配色、FieldAiButton 三模式回调与禁用态）；基础设施单测（tauriStream 事件驱动、appearance init 分步容错、pickFiles 兜底、getStore 失败重试）；真实社区卡导入回归（13 张 discord类脑卡：PNG 抽取→归一化→诊断→三件套插入产物再归一化，样本缺失自动跳过）；Rust cargo test（字体文件名与 font_exists、URL 校验、StreamEvent serde 契约、StreamRegistry 行为、导出文件名清洗、共享 Client）。
- E2E（@playwright/test + connectOverCDP 附加真实 WebView2，规避自带 Chromium 假信心）：金路径 spec + `scripts/e2e-dev.mjs`（CDP 端口启动）；本机 `npm run e2e` 为准入门槛，CI 无头环境起步 continue-on-error。
- 浏览器冒烟（已执行多轮）：11 页面渲染、空白模板手填入库全流程、编辑器七 Tab、成员面板、美化变量工作台与多人群像预览、原始 JSON 抽屉、双主题切换、指南 sticky 几何实测。
- 未覆盖（见 ROADMAP）：E2E 的 CI 无头稳定性、流式二进制通道（D2.2）、MVU 真机验收。
