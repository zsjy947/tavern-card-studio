# ST 真机黄金样本导出指引

> 目的：组装透视器（core/st）的语义以「ST 官方文档 + 真机导出样本」为锚。
> 本文档给出把真实酒馆的实际 prompt 变成黄金 fixture 的操作流程，用于把
> 「按文档实现的近似语义」校准到「与真实 ST 逐字节一致」。
> AGPL 红线：全程不读 SillyTavern 源码，只使用其运行时导出与官方文档。

## 一、原理

ST 实际发送的 prompt = 角色卡 + ST 全局设置 + 对话历史。透视器以「卡内视角 +
ST 默认骨架」模拟。校准的对照实验设计：

- **同一张卡**（用透视器场景里的合成卡导出为 PNG/JSON，导入真酒馆）
- **同一段对话**（按 fixture 的 `input.chat` 逐条手动输入）
- **ST 全默认设置**（干净配置或记录差异项）

得到真实 prompt 后，把它转成 fixture 的 `expected.messages`，跑门禁测试：
diff 不为零的每一处就是一个待修的语义偏差。

## 二、导出步骤

1. **准备干净环境**：建议用独立的 ST 用户目录（`--data:...` 启动参数或全新
   `data/default-user`），确保世界书/预设/作者注释/用户人设全默认。
2. **开启 prompt 日志**：ST「用户设置 → 开发者选项（Developer Options）→
   Log prompts to console」打开。发送消息后，服务端控制台会打印实际发送的
   prompt（chat completion 为 messages 数组 JSON，文本补全为整串）。
3. **导入测试卡**：使用透视器场景同款卡（可从
   `tests/fixtures/st-golden/<name>.json` 的 `input.card` 导出——
   用本工具「转换工具」页把 JSON 转 PNG 或直接导入 JSON）。
4. **复现对话**：严格按 `input.chat` 的顺序逐条发送（ assistant 开场白
   为卡片 greeting，无需手动输入；从第一条 user 消息开始）。
5. **复制 prompt**：控制台输出的 messages 数组完整复制，存为临时 JSON。
6. **转成 fixture**：把数组填进 `<name>.json` 的 `expected.messages`，
   并将 `source` 字段改为 `"real-st"`，同时把「ST 设置里与默认不同的项」
   记入 `input.settingsNotes`（自由文本备注，便于追溯）。
7. **跑门禁**：`npx vitest run st-golden`。diff 即偏差清单。

## 三、优先校准的语义点（文档不完整处）

| 优先级 | 语义点 | 现状 |
|---|---|---|
| P0 | 消息组装顺序（主提示词/世界书/角色字段/示例对话的精确排布） | 按 ST 文档默认序实现 |
| P0 | 对话示例形态（ST 会把 mes_example 拆成 user/assistant 轮次） | v1 保守单段 |
| P1 | 世界书预算填充顺序与 order 的关系 | 按文档：order 高优先保留 |
| P1 | atDepth/作者注释在历史中的精确插入点与 role | 按文档：深度=距末端楼层数 |
| P2 | NOT_ANY/NOT_ALL 的 secondary 语义 | 按文档实现，待复核 |
| P2 | cooldown 的起算点（激活楼 vs sticky 到期楼） | 近似：激活楼起算 |

## 四、注意

- **每份样本一个场景**：不要把多个语义点混在一张卡里，diff 时无法归因。
- **记录版本**：fixture 的 `input.settingsNotes` 里记下 ST 版本号与关键
  设置（tokenizer、上下文长度），不同版本的默认 prompt 文本可能不同。
- **tokenizer 差异**：token 计数（cl100k 估算）允许与 ST 有偏差；校准的
  对象是消息结构与内容归属，不是 token 数值。
