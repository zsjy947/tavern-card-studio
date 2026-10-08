/**
 * 组装透视服务：编排 core/st 纯函数组装器与导出序列化。
 * service 惯例：纯函数、卡对象入参、抛 Error 不弹 toast（通知留视图层）。
 * 计算全部在 core/st（无 UI/存储依赖），本层只补"给人看/给人比对"的序列化。
 */

import type { AnyCard } from '@/core/card/schema';
import { assemblePrompt, type AssembledSegment, type AssembleResult, type StSettings, type WiEntryTrace } from '@/core/st';
import type { ChatState } from '@/core/st/chat';

export type { AssembleResult, StSettings };

export function runAssembly(card: AnyCard, chat: ChatState, settings: StSettings, seed: number): AssembleResult {
  return assemblePrompt(card, chat, settings, seed);
}

/** 同角色相邻段合并（与黄金 fixture 门禁同口径，供与真机导出 diff） */
export function mergeSegmentsForExport(segments: AssembledSegment[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.role === s.role) last.content += `\n${s.content}`;
    else out.push({ role: s.role, content: s.content });
  }
  return out;
}

export function exportAssemblyJson(result: AssembleResult, merged: { role: string; content: string }[]): string {
  return JSON.stringify(
    {
      kind: 'tcs-prompt-xray',
      seed: result.seed,
      tokens: result.tokens,
      warnings: result.warnings,
      messages: merged,
      worldInfo: result.wiTraces.map(traceLine),
      scanText: result.scanText,
      budgetTokens: result.budgetTokens,
    },
    null,
    2,
  );
}

export function exportAssemblyText(result: AssembleResult, merged: { role: string; content: string }[]): string {
  const lines: string[] = [`# 组装透视 · seed=${result.seed} · 合计 ${result.tokens.total} tok${result.tokens.estimated ? '（估算）' : ''}`];
  lines.push('');
  lines.push('## 消息（同角色相邻合并）');
  for (const m of merged) lines.push(`[${m.role}]\n${m.content}\n`);
  lines.push('## 世界书触发明细');
  for (const t of result.wiTraces) lines.push(`#${t.uid} ${t.lamp === 'blue' ? '[蓝灯]' : '[绿灯]'} ${t.activated ? '激活' : '未激活'} ${t.comment} — ${reasonText(t)}`);
  lines.push(`\n扫描窗口：${result.scanText || '（空）'}`);
  if (result.warnings.length) {
    lines.push('## 警告');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

function traceLine(t: WiEntryTrace): string {
  return `#${t.uid} ${t.activated ? '激活' : '未激活'} ${t.comment} ${reasonText(t)}`;
}

/** trace 原因 → 中文（UI 与导出共用） */
export function reasonText(t: WiEntryTrace): string {
  const r = t.reason as { kind: string; [k: string]: unknown };
  switch (r.kind) {
    case 'constant':
      return '蓝灯常驻';
    case 'keyword':
      return `键命中（${(r.matchedKeys as string[]).join('、')}，第 ${(r.messageIndex as number) + 1} 楼）`;
    case 'recursive':
      return `递归激活（来源 #${r.viaUid}）`;
    case 'sticky':
      return 'sticky 维持中';
    case 'disabled':
      return '已禁用';
    case 'vectorized':
      return '向量条目，跳过';
    case 'no-key-match':
      return '键未命中';
    case 'secondary-failed':
      return `secondary 逻辑不符（${logicName(r.logic as number)}）`;
    case 'delayed':
      return `delay 未到期（需 ${r.needMessages} 楼）`;
    case 'cooldown':
      return `冷却中（剩 ${r.remaining} 楼）`;
    case 'probability-failed':
      return `概率未过（掷 ${Number(r.roll).toFixed(2)}，阈值 ${r.threshold}%）`;
    case 'group-lost':
      return `组选举落选（胜者 #${r.winnerUid}）`;
    case 'budget-dropped':
      return '超出预算被丢弃';
    case 'delay-until-recursion':
      return '仅递归可激活，本次递归未命中';
    case 'recursion-disabled':
      return '递归扫描已关闭，永不激活';
    default:
      return r.kind;
  }
}

function logicName(logic: number): string {
  return ['AND_ANY', 'NOT_ALL', 'NOT_ANY', 'AND_ALL'][logic] ?? String(logic);
}
