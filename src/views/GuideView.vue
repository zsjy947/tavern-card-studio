<script setup lang="ts">
/**
 * 使用指南（面向新手）：
 * 每个选项的作用 + 它会以什么方式注入 SillyTavern。
 * 内容为结构化数据，便于后续扩充；页面左侧为章节目录（点击滚动定位）。
 */
import { ref } from 'vue';
import { NSpace, NTag, NIcon, NInput } from 'naive-ui';
import { SearchOutline, SchoolOutline } from '@vicons/ionicons5';

type Block =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; head: [string, string, string]; rows: [string, string, string][] }
  | { type: 'note'; text: string };

interface GuideSection {
  id: string;
  title: string;
  blocks: Block[];
}

const keyword = ref('');

function hit(s: GuideSection): boolean {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return true;
  return JSON.stringify(s).toLowerCase().includes(kw);
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const sections: GuideSection[] = [
  {
    id: 'quickstart',
    title: '① 五分钟上手：从零到酒馆里能用的一张卡',
    blocks: [
      { type: 'p', text: '本工具是一本地的「角色卡工作台」。一张角色卡本质是一个 JSON 数据包，SillyTavern（下称酒馆）读取它，把里面的文字按规则塞进 AI 的上下文，AI 就“扮演”了这个角色。' },
      {
        type: 'list',
        items: [
          '① 导入或新建：卡库页点「导入 PNG / JSON」选文件；或者点「新建角色卡」从空白开始。',
          '② 填内容：点卡片进编辑器，至少填「角色描述 description」和「开场白 first_mes」，改完点右上「保存」。',
          '③ 导出：卡库里选中卡片 → 「导出 PNG」（推荐，带底图方便分享）或「导出 JSON」。',
          '④ 进酒馆：SillyTavern 左上角角色管理 → 导入角色 → 选刚导出的文件 → 开聊。',
        ],
      },
      { type: 'note', text: 'PNG 和 JSON 装的数据完全一样。PNG 只是「图片+隐藏文字」，适合分享；JSON 是纯文本，适合备份和手工修改。两者可随时用「转换工具」互转。' },
    ],
  },
  {
    id: 'inject',
    title: '② 原理：卡里的文字是怎么进入酒馆对话的',
    blocks: [
      { type: 'p', text: '每次你发消息，酒馆都会把「系统提示 + 世界书内容 + 对话历史 + 你最新的输入」拼成一个大请求发给 AI。角色卡的各字段就是在拼装时插到不同位置的：' },
      { type: 'p', text: '角色描述 / 性格 / 场景 → 拼在最前面的系统区（AI 每一轮都能“看到”）；开场白 → 变成对话的第 0 楼 AI 消息；世界书 → 按关键词命中或常驻规则插入；正则 → 在「显示」或「发送给 AI」时对文本做查找替换；深度注入 / post_history_instructions → 插到对话历史的末尾附近，离最新消息越近，AI 听得越牢。' },
      { type: 'note', text: '距离最新消息越近的内容对 AI 影响越强；太长的设定建议移进世界书，用关键词按需注入，省 token 也更准。' },
    ],
  },
  {
    id: 'fields',
    title: '③ 编辑器字段速查：作用 + 注入位置',
    blocks: [
      {
        type: 'table',
        head: ['字段', '它是什么（作用）', '在酒馆里注入到哪'],
        rows: [
          ['name 角色名', '角色的名字，也是 {{char}} 宏的值', '对话中的角色名显示；{{char}} 展开为它'],
          ['description 角色描述', '人设核心：身份、外貌、性格、说话风格、与你的关系', '系统区，永远注入（最优先写好这里）'],
          ['personality 性格', '性格概要（summary 式，几行即可）', '系统区，紧跟 description 之后'],
          ['scenario 场景', '故事背景/当前情境', '系统区，性格之后'],
          ['first_mes 开场白', 'AI 说的第一句话，决定开局', '第 0 楼 AI 消息'],
          ['alternate_greetings 备选开场白', '多个开局版本', '第 0 楼的切换器（左下角 < > 切换）'],
          ['mes_example 对话示例', '示范 AI 的口吻与格式，用 <START> 分隔多组', '作为示例对话注入，AI 模仿但不算正式对话'],
          ['system_prompt 系统提示', '覆盖酒馆默认主系统提示', '替换主系统提示（不懂别改，留空即用默认）'],
          ['post_history_instructions', '对话历史之后的强指令（文风约束、禁止出戏常用位）', '拼在对话历史之后，靠得近、约束力强'],
          ['creator_notes 创作者备注', '写给「人」看的说明卡', '不注入给 AI，仅角色卡界面展示'],
          ['tags 标签', '卡的分类关键词', '不注入，仅供本工具/酒馆内检索'],
          ['character_version / creator', '版本号与作者署名', '不注入，仅展示'],
        ],
      },
      { type: 'note', text: '所有文本都支持酒馆宏：{{user}}=你的名字、{{char}}=角色名、{{random:a,b,c}}=随机、{{setvar:名字=值}}/{{getvar::名字}}=变量。写卡时用 {{user}} 指代玩家，不要写死“你”。' },
    ],
  },
  {
    id: 'worldbook',
    title: '④ 世界书：按需注入的设定库（省 token 的关键）',
    blocks: [
      { type: 'p', text: '世界书（Lorebook / 世界信息）是一堆「条目」。每个条目有关键词和内容：当对话里出现关键词时，内容才被注入；这叫“按需注入”。设定库大但不是每次全量发送，这是长篇设定不爆 token 的正解。' },
      {
        type: 'table',
        head: ['选项', '作用', '注入行为'],
        rows: [
          ['keys 主关键词', '触发条目的词（多个用回车分隔）', '对话近期文本命中任一词 → 注入内容'],
          ['secondary_keys 次级关键词', '配合“逻辑”做与/非判断', '按逻辑门（且/非）参与触发判定'],
          ['constant 常驻（蓝灯）', '不需要关键词、永远生效', '每轮都注入（状态栏说明、核心规则用蓝灯）'],
          ['selective + 逻辑', '主次关键词的与/或/非组合', '决定触发条件更精确'],
          ['insertion_order 顺序', '同位置多条目时的排序', '数字小的先注入'],
          ['position 位置', '插到角色定义之前还是之后', 'before_char/after_char；酒馆高级位置（作者注释/系统深度等）保存在条目扩展里'],
          ['depth 深度 / probability 概率', '酒馆专属微调', '按对话深度插入、按概率注入，本工具保留不丢失'],
          ['enabled 启用', '条目开关', '关闭的条目永不注入'],
        ],
      },
      { type: 'note', text: '「内嵌世界书」随卡走（导入导出都在卡里）；「全局世界书」存在酒馆里，可被多张卡共用。世界书 Tab 支持两者互转导出。蓝灯=常驻、绿灯=关键词触发，是社区的俗称。' },
    ],
  },
  {
    id: 'regex',
    title: '⑤ 正则脚本：控制「显示」与「发给 AI 的文本」',
    blocks: [
      { type: 'p', text: '正则脚本 = 查找替换规则。AI 输出的原始文本先经过正则处理，才会显示给你 / 发送给 AI。美化卡的状态栏全靠它：AI 只输出一个占位符如 <StatusPlaceHolder/>，正则把它替换成一整块 HTML 界面。' },
      {
        type: 'table',
        head: ['选项', '作用', '注入/生效位置'],
        rows: [
          ['findRegex 查找', '要匹配的文本（支持 /pattern/flags 写法）', '—'],
          ['replaceString 替换', '替换成的内容（支持 {{user}}/{{char}} 宏和 HTML）', '命中处被替换'],
          ['placement 位置', '对哪些文本生效：0=界面渲染 / 1=用户输入 / 2=AI 输出 / 6=思维链', '多选；美化卡一般勾 2'],
          ['仅显示 markdownOnly', '只在聊天界面替换，发给 AI 的仍是原文', '界面层'],
          ['仅提示 promptOnly', '只改发给 AI 的内容，界面显示原文', '上下文层'],
          ['minDepth / maxDepth', '只对最近 N 楼生效', '楼层深度过滤'],
          ['trimStrings', '替换后再删掉的子串', '清理残留'],
          ['disabled 停用', '临时关闭脚本', '不生效'],
        ],
      },
      { type: 'note', text: '状态栏的 HTML 要在酒馆里正常渲染，需确认酒馆设置中开启了「在消息中渲染 HTML/自定义 CSS」相关选项。正则 Tab 下方有实时测试器，可以先本地试替换效果。' },
    ],
  },
  {
    id: 'scripts',
    title: '⑥ 脚本（酒馆助手）与扩展',
    blocks: [
      { type: 'p', text: '脚本 Tab 编辑的是「酒馆助手（TavernHelper）」脚本：需要酒馆里安装酒馆助手扩展才能运行。脚本在特定事件（如每次 AI 回复后）自动执行 JS，常用来维护状态栏变量（把 MVU/变量表刷新成面板数据）。' },
      {
        type: 'list',
        items: [
          'autoRun 自动运行：进入聊天时自动执行一次（初始化变量用）。',
          'event 触发时机：脚本监听的酒馆助手事件名。',
          'content 内容：JS 代码本体；预览器不执行脚本，实际效果在酒馆里验证。',
        ],
      },
      { type: 'p', text: '扩展 Tab 的 depth_prompt（深度注入）是把一段提示以指定「角色」身份插到对话历史倒数第 N 层——离最新消息很近，常用于强调当前状态/口吻。role 决定这条内容以 system/user/assistant 哪种身份出现。' },
    ],
  },
  {
    id: 'beautify',
    title: '⑦ 美化工作台：三件套一键插入',
    blocks: [
      { type: 'p', text: '「美化三件套」= ① 开场白里加占位符 ② 注册渲染正则（占位符 → HTML 界面）③ 世界书加一条蓝灯规则（告诉 AI 何时输出占位符与变量含义）。三件互相配合，缺一不可。本工具按模板一键插入并保证重复点击不叠加。' },
      {
        type: 'list',
        items: [
          '图片一律用外链：本地图填 Windows 路径（自动转 file:/// 开头），或图床 https:// 链接。别人（或别的电脑）用你的卡时，本地图路径必须同样存在。',
          '刻意不做 base64 嵌图：内嵌图会把卡撑到几 MB，且每轮对话都占上下文，代价极高。',
          '预览是沙箱渲染：不执行脚本，最终效果以酒馆为准。',
        ],
      },
    ],
  },
  {
    id: 'ai',
    title: '⑧ AI 中心：渠道、生成与用量',
    blocks: [
      {
        type: 'list',
        items: [
          '渠道：OpenAI 兼容格式填 base_url（如 https://api.deepseek.com/v1）+ API Key + 模型名；文本和生图渠道分开配置。「激活」标记当前使用的渠道（同类型只激活一个）。',
          '全局系统提示词：渠道级的个性化前缀（比如“所有生成用轻小说文风”），自动插到每次 AI 请求的最前面。',
          '并发上限：同时最多几个 AI 请求（默认 2），防止 429 限流；429/5xx 自动退避重试。',
          '字段按钮：编辑器里每个字段旁的「生成/优化/翻译」按钮只作用于该字段，提示词可在模板中心「提示词库」里改。',
          '用量记录：每次调用的 token 与耗时都会记录，统计看板可看趋势。',
        ],
      },
      { type: 'note', text: 'API Key 只保存在本地数据库，不出本机。' },
    ],
  },
  {
    id: 'diagnosis',
    title: '⑨ 诊断与调整：体检报告怎么看',
    blocks: [
      {
        type: 'table',
        head: ['检查项', '含义', '建议动作'],
        rows: [
          ['缺少 description / first_mes', '卡的最小可用集不完整，AI 无人设、无开局', '补字段'],
          ['token 超限', '单字段太长（如描述 > 4000 token），挤占上下文还稀释重点', '精简，或把细节移入世界书按需注入'],
          ['世界书键冲突', '多个条目共用同一关键词且内容不同，可能重复/矛盾注入', '合并条目或区分关键词'],
          ['死条目', '条目既无关键词也非常驻，永远不会被注入', '补关键词或设为蓝灯'],
          ['正则语法错误', 'findRegex 不是合法正则', '按报错修正写法'],
          ['未识别的宏', '{{...}} 拼写可能不对，酒馆不会展开', '对照宏表修正'],
          ['base64 嵌图', '卡内有内嵌图片，体积与上下文双膨胀', '改成外链'],
        ],
      },
      { type: 'p', text: '「AI 诊断（卡医）」会把整卡交给 LLM 做维度评分并给出可执行的处方；应用处方前有 diff 预览，且保存自动生成版本快照，可随时回滚。' },
    ],
  },
  {
    id: 'convert',
    title: '⑩ 转换工具：PNG ⇄ JSON 与「双写」',
    blocks: [
      {
        type: 'list',
        items: [
          'PNG → JSON：把图片里隐藏的卡数据解出来；支持批量（自动打包 zip）。',
          'JSON → PNG：把 JSON 嵌进一张底图；不选底图时用纯色占位图。',
          '双写 ccv3 + chara：同一份数据在 PNG 里写两份（V3 标准块 + V2 兼容块）。酒馆新版读 ccv3，旧版/部分前端读 chara——双写保证谁都能读。设置页可关（仅高级场景）。',
          '导入失败提示「卡数据校验失败」：卡可能来自非标准工具。可在编辑器「扩展 → 原始 JSON」里手工修复缺失字段。',
        ],
      },
    ],
  },
  {
    id: 'wizard',
    title: '⑪ 生成向导 / 模板中心 / 同人工坊',
    blocks: [
      {
        type: 'list',
        items: [
          '生成向导：选模板 → 一句话设定 AI 扩写 → 按顺序逐字段生成（描述→性格→场景→示例→开场白，后一步引用前面产物）→ 生成整卡入库。小白推荐「精简人设」模板，四步出卡。',
          '模板中心：四类模板（卡片结构/状态栏/正则/提示词）。可以把调好的卡「沉淀为模板」复用；也支持导入导出 JSON 分享。',
          '同人卡工坊：导入整本小说（txt/epub）→ 自动切章 → 扫描角色 → 选角色抽卡 → 生成世界书/开场白/用户人设 → 导出成卡。项目进度自动保存，中途关掉可续跑。',
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: '⑫ 常见问题',
    blocks: [
      {
        type: 'list',
        items: [
          '导入 JSON 失败？→ 看报错里的字段路径；多数是非标准卡缺 id/缺 data 块，本工具已做最大兼容，仍失败时用「扩展 → 原始 JSON」修。',
          '导出的 PNG 酒馆不认？→ 保持设置页「双写」开启；酒馆版本过旧（不读 ccv3/chara）则需升级。',
          '状态栏不显示？→ ① 酒馆需开 HTML 渲染；② 正则位置要包含「AI 输出」；③ 占位符必须出现在消息里（三件套已自动处理）。',
          '卡太大 / 回复变慢？→ 静态诊断看 token 超限项；把低频设定移入世界书（绿灯），删 base64 嵌图改外链。',
          'AI 生成的结果不满意？→ 模板中心「提示词库」里改对应字段的提示词；或在渠道「全局系统提示词」里统一约束文风。',
          '数据安全？→ 全部数据在本机（桌面模式 exe 旁 data/ 目录，浏览器模式 IndexedDB）。设置页可一键备份/恢复 zip。',
        ],
      },
    ],
  },
];
</script>

<template>
  <div class="guide-root">
    <div class="guide-head">
      <span class="guide-title">
        <NIcon size="18" style="vertical-align: -3px; margin-right: 6px"><SchoolOutline /></NIcon>使用指南 · 从零做出能在酒馆跑的卡
      </span>
      <NTag size="small" :bordered="false" type="info">写给第一次做卡的你</NTag>
      <NInput v-model:value="keyword" size="small" placeholder="搜索指南内容…" clearable style="width: 200px; margin-left: auto">
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
    </div>

    <div class="guide-layout">
      <!-- 左侧目录 -->
      <aside class="guide-toc">
        <template v-for="s in sections" :key="s.id">
          <button v-if="hit(s)" class="toc-item" @click="scrollTo(s.id)">{{ s.title }}</button>
        </template>
      </aside>

      <!-- 正文 -->
      <div class="guide-body">
        <section v-for="s in sections" v-show="hit(s)" :id="s.id" :key="s.id" class="guide-section">
          <h2>{{ s.title }}</h2>
          <template v-for="(b, bi) in s.blocks" :key="bi">
            <p v-if="b.type === 'p'" class="g-p">{{ b.text }}</p>
            <ul v-else-if="b.type === 'list'" class="g-list">
              <li v-for="(it, i) in b.items" :key="i">{{ it }}</li>
            </ul>
            <div v-else-if="b.type === 'table'" class="g-table-wrap">
              <table class="g-table">
                <thead>
                  <tr><th v-for="h in b.head" :key="h">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(r, ri) in b.rows" :key="ri">
                    <td v-for="(c, ci) in r" :key="ci" :class="{ 'g-td-first': ci === 0 }">{{ c }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else-if="b.type === 'note'" class="g-note">{{ b.text }}</div>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide-root { max-width: 1080px; margin: 0 auto; }
.guide-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.guide-title { font-size: 16px; font-weight: 800; }
.guide-layout { display: flex; gap: 18px; align-items: flex-start; }
.guide-toc {
  flex: none; width: 230px; position: sticky; top: 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.toc-item {
  text-align: left; background: rgba(255,255,255,.02); color: inherit;
  border: 1px solid rgba(255,255,255,.06); border-radius: 10px;
  padding: 8px 10px; font-size: 12px; line-height: 1.5; cursor: pointer;
}
.toc-item:hover { border-color: rgba(139,92,246,.55); color: #c4b5fd; }
.guide-body { flex: 1; min-width: 0; }
.guide-section {
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px; padding: 16px 20px; margin-bottom: 16px;
  scroll-margin-top: 60px;
}
.guide-section h2 { font-size: 15px; font-weight: 800; margin: 0 0 10px; color: #d8ccff; }
.g-p { font-size: 13px; line-height: 1.9; margin: 8px 0; opacity: .92; }
.g-list { margin: 8px 0; padding-left: 20px; }
.g-list li { font-size: 13px; line-height: 1.9; margin-bottom: 4px; opacity: .92; }
.g-table-wrap { overflow-x: auto; margin: 10px 0; }
.g-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.g-table th {
  text-align: left; background: rgba(139,92,246,.14); color: #c4b5fd;
  padding: 7px 10px; border: 1px solid rgba(255,255,255,.08); white-space: nowrap;
}
.g-table td { padding: 7px 10px; border: 1px solid rgba(255,255,255,.07); line-height: 1.7; vertical-align: top; }
.g-td-first { font-weight: 700; white-space: nowrap; }
.g-note {
  margin-top: 10px; font-size: 12.5px; line-height: 1.8;
  background: rgba(139,92,246,.09); border-left: 3px solid #8b5cf6;
  border-radius: 6px; padding: 8px 12px; color: #cfc3f5;
}
@media (max-width: 860px) {
  .guide-layout { flex-direction: column; }
  .guide-toc { position: static; width: 100%; flex-direction: row; flex-wrap: wrap; }
}
</style>
