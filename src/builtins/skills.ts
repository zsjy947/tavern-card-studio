/**
 * 内置诊断/生成 skill（system_prompt + steps + output_schema，可配置可新建）。
 * 「卡医」借鉴 piney 小皮医生 + Novalcard 自检（OOC/经历互串/时间线/编造）。
 */
import { getStore } from '@/db';
import type { SkillRow } from '@/services/types';

export const CARD_DOCTOR: SkillRow = {
  id: 'skill-card-doctor',
  name: '卡医（全面体检）',
  systemPrompt: `你是资深的 SillyTavern 角色卡医师。对给定的角色卡做全面体检，输出结构化 JSON 诊断报告。

评估维度：
1. 【人设完整性】name/description/personality/scenario/first_mes 是否齐备且互相咬合
2. 【一致性】人设、开场白、世界书之间有无矛盾（OOC 风险）；时间线/经历是否自洽（经历互串检查）
3. 【可演绎性】是否有具体事件与细节支撑，还是空泛标签堆砌
4. 【token 经济】各字段长度是否超限（结合给出的统计）
5. 【世界书】键设计是否合理（覆盖/冲突/蓝灯滥用）、条目内容质量
6. 【正则与脚本】语法与作用域问题（结合静态检查结果）
7. 【开场白】钩子强度、{{user}} 宏使用、视角一致
8. 【编造风险】哪些内容缺乏原文/设定依据、可能诱导模型臆造

铁律：诊断必须引用卡内具体位置/字段为证据；处方必须可执行（给出改法或改写文本）；不确定就说不确定。`,
  steps: [
    '通读全卡字段与统计信息，列出客观事实（字段长度、条目数、正则数）',
    '逐维度评估：每个维度给出 0-10 分与一句话理由',
    '汇总问题清单：按严重度排序，每条附证据字段',
    '给出处方：每条问题对应的修复建议；重要字段给出可直接替换的改写文本',
    '输出最终 JSON 报告',
  ],
  outputSchema: `{
  "overall": { "score": 0-100, "summary": "一句话总评" },
  "dimensions": [ { "name": "维度名", "score": 0-10, "comment": "评语" } ],
  "issues": [ { "severity": "error|warn|info", "field": "字段", "evidence": "卡内证据", "problem": "问题描述" } ],
  "prescriptions": [ { "for": "对应问题", "action": "修复动作", "rewrite": "可选：直接可用的改写文本" } ]
}`,
  builtin: true,
};

export const CARD_TIGHTENER: SkillRow = {
  id: 'skill-tightener',
  name: '瘦身师（token 优化）',
  systemPrompt: `你是角色卡压缩专家。在不丢失关键设定与人物弧光的前提下压缩给定字段的 token：
- 合并重复表述；空泛形容词换成具体短句；删除不影响演绎的修饰
- 目标：压缩率 30-50%
- 输出 JSON：{"rewritten":"压缩后文本","beforeTokens":N,"afterTokens":M,"removed":["删了什么，为什么安全"]}`,
  steps: ['识别信息密度低的段落', '合并与删减', '输出 JSON'],
  outputSchema: '{"rewritten":"...","beforeTokens":0,"afterTokens":0,"removed":["..."]}',
  builtin: true,
};

export async function seedSkills(): Promise<void> {
  const store = await getStore();
  const existing = await store.list<SkillRow>('skills');
  for (const s of [CARD_DOCTOR, CARD_TIGHTENER]) {
    if (!existing.some((e) => e.id === s.id)) await store.put('skills', s.id, s);
  }
}
