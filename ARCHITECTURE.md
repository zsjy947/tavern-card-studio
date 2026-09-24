# TavernCard Studio 架构说明

分层原则：**领域逻辑纯 TS 无 UI 依赖 → 服务层编排持久化与 AI → 视图层只做交互**。依赖单向向下，同层禁止互引。

```
┌─ views/ (Vue3 + NaiveUI)        交互与呈现，不含业务规则
│   └─ components/                跨页面复用组件
├─ stores/ (Pinia)                跨页面共享状态（卡列表/渠道）
├─ services/                      业务编排：导入去重、版本快照、AI 用量、
│                                 三件套插入、诊断执行、流水线持久化、备份
├─ db/                            存储抽象（Memory / IndexedDB / Tauri SQLite）
├─ builtins/                      内置模板资产（首启播种，builtin 标记，可克隆）
└─ core/                          纯函数领域库（全部可单测，无任何框架依赖）
```

## core 各模块职责与关键决策

### card（schema / normalize / hash）
- zod 定义 V2/V3 全字段；`passthrough` 保留社区卡私有扩展。
- `parseLooseCard`：data 块优先，无 data 时从 V1 顶层合成；tags 兼容数组/逗号串；顶层冗余字段 data 优先。
- 导出时补齐顶层冗余（name/description/... + creatorcomment/avatar/talkativeness/fav/create_date）。
- `dataHash`：FNV-1a 双轮 64bit，仅对影响行为的 15 个字段计算，稳定字符串化（键排序）保证同内容不同键序同哈希。用于导入去重与"有无实质修改"判断。

### png（codec）
- 手写 PNG 解析：签名校验 → chunk 遍历（长度/CRC 校验）→ tEXt 编解码（keyword Latin-1 + \0 + UTF-8 文本）。
- 读取顺序对齐 ST：ccv3 优先，chara 回退；base64 → UTF-8 JSON；宽容处理 data: 前缀、URL 编码、明文 JSON。
- 写入：移除旧 chara/ccv3 块后插到 IEND 前；默认双写。
- `makePlaceholderPng`：手写 zlib stored 块 + adler32，无底图导出用。

### lorebook（convert）
- 嵌套 ⇄ 扁平双射。ST 专属字段（probability/depth/selectiveLogic/group/递归控制/role/vectorized…）以 extensions 为真值载体：嵌入→全局时读 extensions 覆盖默认，全局→嵌入时全部写回 extensions。
- 高级位置（AN/EM/atDepth 等）在嵌入卡中只能表达 before/after，原始数值保留在 extensions.position。

### llm（client / extract / image）
- `LlmClient(config, fetchImpl)`：fetchImpl 注入点，Tauri 模式可替换为插件 fetch 解决 CORS。
- SSE 手写解析（按 data: 行），429/5xx 指数退避（上限 15s），finish_reason=length 续写（非流式与流式两条路径）。
- `extractJson`：剥思考标签 → 代码块 → 平衡扫描（字符串内括号免疫）→ 尾逗号修复。
- 生图：OpenAI images/generations（b64/url 双兼容）+ NovelAI 原生（zip 内 png，JSZip 解）。

### stats（tokens）
- 分类四桶（spec 宏与标签 / 词边界 / 其他=CJK 逐字）对齐 piney 口径。
- 超 8K 字符片段走 CJK+长度粗估——BPE 对超长重复串是性能悬崖（真实事故：500KB base64 图统计卡死）。

### novel（source）
- 章节头正则覆盖中文网文惯例（第X章/回/节/卷/幕/折/话、楔子/序章/番外/Chapter N）；无头时按长度均分并在换行处断开。
- epub：container.xml → opf → manifest/spine 顺序 → xhtml 轻量正文提取（环境无关，Node 可测）。
- 角色扫描：贪心 2-4 字词频 + **边缀折叠**——中文人名总在词块边缘（"沈舟看着"→"沈舟"），长词被高边缀支持时判定为"名+谓语粘连"丢弃；仅边缀出现的名字也参与评分。
- 上下文检索：命中段落收集（每章上限）→ 超总量时跨章等距采样。

### diag（staticChecks）
- 本地零成本检查：结构缺失（error）/ token 超限（分级）/ 世界书键冲突与死条目 / 正则语法 / base64 嵌图体积 / 宏使用建议。
- 阈值可调，供 UI 与卡医 skill 复用。

## db：三驱动等价性

| 驱动 | 场景 | 行为 |
|---|---|---|
| MemoryStore | vitest | Map 表，`setStore()` 注入 |
| IndexedDbStore | 浏览器/dev | 每表一个 objectStore，行 = `{id, value}` |
| TauriSqlStore | 桌面 | `window.__TAURI__.core.invoke('plugin:sql|…')`，每表 `CREATE TABLE (id TEXT PRIMARY KEY, json TEXT)`，UPSERT |

选择逻辑：`isTauri()` → SQLite，失败回退 IndexedDB；无 indexedDB 全局则 Memory。业务代码只面对 `DataStore` 接口（get/list/put/bulkPut/delete/clear/dump）。

## services 关键流程

### 导入（importCardFromJson / importCardFromPng）
```
原始 JSON/PNG bytes
  → parseLooseCard 归一化（可选 convertSpec）
  → dataHash 与现有卡比对（软删除除外）
     ├─ 命中：覆盖该行（replacedName 提示）
     └─ 未命中：新建行（含 tokenStats 全量统计）
  → addVersion('导入') 初始快照
  → PNG 导入附底图 dataURL 封面
```

### 保存（saveCard）
响应式消毒（JSON 往返剥 Proxy）→ toRow 重算 hash/tokens → put → hash 变化则 addVersion（版本上限 50，超出删最老）。

### 美化三件套（beautifyService）
1. first_mes/description 尾部插占位 tag（已存在则跳过）
2. extensions.regex_scripts 注册/替换渲染脚本（findRegex=tag，replaceString=变量已替换的 HTML，`$`→`$$`、换行→`\n` 转义）
3. character_book 追加规则条目（蓝灯 constant，含变量清单）
幂等：重复插入不叠加（tag 存在检测 + 正则 normalize 匹配 + 条目备注去重）。

### 同人工坊流水线（projectService + NovelWorkshopView）
阶段机：chapters → scan → select → context → extract(+worldbook) → style/greeting → persona → done。
每步 `updateProject` 深拷贝改写落库（断点续跑）；LLM 步骤消费内置提示词（Novalcard 体系移植），全书分析按 10 章分块增量拼接。

### 诊断（diagService）
静态检查即时执行；卡医 = skill（systemPrompt+steps+outputSchema）+ 静态检查摘要 + 卡全文（base64 脱脂、60K 截断）→ 结构化报告；处方经 patch JSON → diff 预览 → applyPatch 保存（自动快照可回滚）。

## 视图层约定

- 路由 hash 模式（file:// 与 Tauri 协议下可用）。
- naive-ui `NGrid` 的直接子元素只能是 `NGi`，其余组件会被静默丢弃不渲染（真实事故：诊断页明细面板空白）；单卡片布局直接用 NCard。
- 社区卡 schema 必须宽容：`regex_scripts`/`TavernHelper_scripts`/`QuickReply`/世界书条目的 `id` 在真实卡里普遍缺失，schema 层按序号确定性兜底（随机 id 会破坏 dataHash 去重），未知字段 passthrough 保留。
- 编辑器视图持有卡的深拷贝本地态，`markDirty` 跟踪，保存走 saveCard；路由 `:id` 变化时必须重载（组件复用），否则保存会写入错误的卡。
- 本地撤销栈在撤销/重做前必须 flush 待提交的节流快照，否则最近 500ms 内的编辑丢失。
- iframe 预览 `sandbox="allow-same-origin"`（不执行脚本优先安全；TavernHelper 运行时变量刷新由模板 JS 在真机环境自理）。
- CodeMirror 6 轻封装 + 自带 One Dark 仿制主题（免去 theme-one-dark 依赖）。

## 测试策略

- core 单测为主力（83 用例）：编解码往返、迁移矩阵、互转语义、mock fetch 的重试/续写/SSE-JSON、epub 构造、扫描折叠、静态检查。
- services 集成测试用 MemoryStore 全链路（导入去重/快照回滚/备份恢复/三件套幂等）。
- 浏览器冒烟（本次已执行）：11 页面渲染、编辑器填写保存、状态栏预览。
- 未覆盖（后续补）：组件级渲染测试（@vue/test-utils）、E2E。
