# TavernCard Studio 待改进清单（ROADMAP）

> 按「已知事项 / 下一迭代 / 中期方向」分组。条目按优先级排序。
> 架构与已实现功能见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 迭代五（MVU/世界书生成/AI 状态栏）与迭代六（工程化清尾）已实施完成并归档；规划细节已并入 ARCHITECTURE，本文「下一迭代」即在此基础上的后续规划。

## 一、已知事项（当前版本边界）

- **MVU 真机验收清单（人工验收）**：① 酒馆端装齐 [酒馆助手 JS-Slash-Runner](https://n0vi028.github.io/JS-Slash-Runner-Doc/)（渲染器开启、代码折叠=仅前端）+ 提示词模板 + [MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate)；② 导入 MVU 产物卡新建聊天，断言：initvar 变量初始化生效、AI 回复含 `<UpdateVariable>` 块且被两段美化正则正确折叠/展开、状态栏占位符渲染、长对话下「只发最新 N 楼」裁剪生效、Zod clamp/prefault 生效（喂越界值观察）；③ 记录 MVU/酒馆助手版本号备查。
- 内嵌受限浏览器中 naive-ui 虚拟列表（NSelect 下拉）可能不渲染选项；真实 Chrome / Tauri WebView2 正常。卡库行虚拟化（>500 张）基于 @vueuse 自绘行容器，不受此影响。
- 字体在线下载：桌面模式走 Rust 直连（无跨域限制）；浏览器模式受 CORS 限制，GitHub Releases 渠道字体不可下载（raw 仓库文件类可用），可用「导入本地字体」替代。
- 真实 LLM 渠道行为（GLM/DeepSeek 测连、流式对话、Rust 流式代理真机链路——尤其攒批后的帧合并观感）需要配置渠道后人工验证；自动化测试覆盖到 mock fetch 层。
- Tauri 打包需本机 Rust 工具链；无 Rust 时浏览器模式运行全部功能（存储落 IndexedDB）。`npm run release` 后 `src-tauri/target` 被清理的话下次构建全量重编。
- i18n 骨架只覆盖通用层（导航/命令分组/FieldAiButton 等），视图深层文案渐进迁移中；en-US 允许缺口（fallback zh-CN）。
- E2E（`npm run e2e`）需先 `npm run e2e:dev` 启动带 CDP 端口的应用；文件导入/导出对话框在 CDP 桥不可控，相关路径由真实卡回归与 PNG codec 单测兜底。
- 同渠道大量共享类名/组合样式的 AI 状态栏，点选定位可能查不到单一规则块——已降级为「末尾追加覆盖规则」建议，属预期行为。

## 二、下一迭代（迭代七：真机验收收口 + 流式管道升级 + i18n 深化）

1. **MVU/流式真机验收与修复**：按 §一 MVU 验收清单逐项走查；同时验证攒批后长回复的流式观感（首字延迟、逐帧渲染平滑度）。发现问题只修不改架构。
2. **流式二进制通道（D2.2，承接技术债）**：`llm.rs` 迁 `Channel<InvokeResponseBody>` 发 `InvokeResponseBody::Raw(bytes)`（tauri ≥2.10，前端收 ArrayBuffer），彻底移除 base64 +33% 膨胀与 JSON 包装；StreamEvent 契约调整为 JSON 控制消息（headers/done/error）+ Raw 二进制帧混排，`tauriStream.ts` 适配（onmessage 分支区分 object / ArrayBuffer）。serde 契约锚点测试先行；D2.1 攒批已独立合入可回退。实施前先在真机验证 Raw 通道在 WebView2 的送达形态。
3. **E2E 进 CI（Windows runner）**：`e2e` job 在 windows-latest 启动 dev + CDP，起步 `continue-on-error: true` 收集稳定性数据，连续绿 10 次后转为必须项；备选退路 tauri-driver + WebdriverIO。
4. **i18n 深层迁移第一批**：设置页 / 卡库 / 转换器文案表抽取（预计 ~120 键）；en-US 覆盖率达 40% 后在模板中心加「语言贡献说明」。
5. **AI 状态栏与 MVU 变量清单闭环**：应用 AI 状态栏后，把 AI 变量清单与 `tcsMvuVarGroups` 做一次同步合并（新增路径自动进 initvar/更新规则，减少人工审查）；漂移清单（变量 Tab）支持一键「补充定义」。
6. **导入预设体验补全**：预设重命名/删除单个（当前只提供「删最新」）；拖放导入路径同样接入导入选项对话框。

## 三、中期方向（迭代八及以后）

1. **世界书批量生成评审表虚拟化**：大型/超大型目标（150-500 条）时评审表换虚拟列表；批量注入性能基线测试（对齐工坊「响应式消毒」约定）。
2. **转换器批量断点**：多文件转换中断续跑（最近转换记录已具备元数据基础）。
3. **命令面板与快捷键扩展**：`>` 前缀命令模式（直接执行注册表动作）、编辑器 scope 快捷键补全（Tab 间跳转、当前 Tab 动作暴露）。
4. **CardForge 后续评估项**（此前明确非目标，视社区反馈再启动）：EJS 模板编辑器、酒馆助手脚本 AI 全自动生成、独立 NPC 生成器页、状态栏沙盒（安全 iframe 预览增强）、Live2D AI 助手、多服务商原生接入、自动更新器。
5. **测试纵深**：Rust 侧攒批行为单元化（抽出可测 Batcher）；生成类 prompt 的快照回归（防误改提示词导致产出漂移）。

## 四、历史迭代归档说明

- 早期规划（原 `plans/TavernCard_Studio.md` 项目规划 M1-M3、`plans/Optimization_Roadmap.md` P0 优化、`plans/Iteration3_MultiChar_EditorUX_Plan.md` 多人卡与编辑器 UX 迭代）中的内容**均已实现**，规划细节已并入 [ARCHITECTURE.md](./ARCHITECTURE.md) 的实际实现描述。参考蓝本：piney（工作站形态）、sillytavern-Novalcard（小说→成卡流水线）。
- **迭代五**（MVU 变量系统 13 件套 / 世界书 AI 批量生成 / 小说 5 类轨迹提取 / AI 状态栏生成 / 预算化卡上下文；借鉴 CardForge 方法论与 MagVarUpdate 社区规范文本，未复制 GPL 源码）与**迭代六**（CI 护栏、技术债清偿 D1/D2.1/D3-D7、P1 功能收尾、P2 体验深化、P3 工程化）已实施完成：规划文档删除，实现细节并入 ARCHITECTURE.md，未竟事项保留于本文件 §一/§二：
  - 迭代六批次 E1（MVU 真机验收清单）转为本文 §一第一条人工验收项。
  - 迭代六 D2.2（流式原始二进制通道）需真机验证 WebView2 的 Raw 帧送达形态，移交迭代七（§二第 2 条）。
  - ROADMAP P1-1（工坊断点拆分）在迭代五 C2 中完整落地：extract → worldbook 两步独立重跑，产物分落 `extractedCard` 与 `worldbookEntries`。
