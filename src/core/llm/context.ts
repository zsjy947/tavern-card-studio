/**
 * 预算化卡上下文组装器：把角色卡关键信息压进固定字符预算，供所有生成类 AI 调用附带。
 *
 * 组装策略：
 * - 基础字段：角色名 / 性格 / 场景 / 描述前 500 字 / 开场白前 1000 字
 * - 世界书两组：蓝灯（constant）全展、每条截 1000 字；绿灯按 matchText 关键词命中才塞（每条截 150 字），
 *   无 matchText 时回退前 20 条各 150 字
 * - 总预算默认 12000 字符，超支即止并注明「剩余 N 条未展示」
 * - 附正则 / 酒馆助手脚本清单各前 5 个（名称 + 模式标记）
 * 纯函数，无 UI / 存储依赖。
 */
import type { AnyCard, BookEntry } from '../card/schema';

export interface BuildCardContextOptions {
  /** 绿灯条目的匹配文本（通常为最近对话或用户需求）；缺省回退前 20 条各 150 字 */
  matchText?: string;
  /** 总字符预算（默认 12000） */
  budget?: number;
}

const DESC_SLICE = 500;
const FIRST_MES_SLICE = 1000;
const BLUE_SLICE = 1000;
const GREEN_SLICE = 150;
const GREEN_FALLBACK_COUNT = 20;

export function buildCardContext(card: AnyCard, opts: BuildCardContextOptions = {}): string {
  const budget = opts.budget ?? 12_000;
  const data = card.data as Record<string, unknown>;
  const sections: string[] = [];
  let used = 0;

  const push = (text: string): boolean => {
    const t = text.trim();
    if (!t) return true;
    if (used + t.length > budget) return false;
    sections.push(t);
    used += t.length;
    return true;
  };

  /* ---- 基础字段 ---- */
  const basics = [
    `【角色名】${String(data.name ?? '')}`,
    data.personality ? `【性格】${String(data.personality)}` : '',
    data.scenario ? `【场景】${String(data.scenario)}` : '',
    data.description ? `【描述】${String(data.description).slice(0, DESC_SLICE)}` : '',
    data.first_mes ? `【开场白（节选）】${String(data.first_mes).slice(0, FIRST_MES_SLICE)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  push(basics);

  /* ---- 世界书：蓝灯全展，绿灯按命中 ---- */
  const entries = ((data.character_book as { entries?: BookEntry[] } | undefined)?.entries ?? []);
  const blue = entries.filter((e) => e.constant && e.enabled !== false);
  const green = entries.filter((e) => !e.constant && e.enabled !== false);

  let shown = 0;
  let exhausted = false;
  for (const e of blue) {
    if (!push(`【世界书·常驻】${e.comment || '(未命名)'}：${e.content.slice(0, BLUE_SLICE)}`)) {
      exhausted = true;
      break;
    }
    shown++;
  }

  let greenPool = green;
  if (opts.matchText?.trim()) {
    const text = opts.matchText;
    greenPool = green.filter((e) => e.keys.some((k) => k && text.includes(k)) || (text && e.comment && text.includes(e.comment)));
  } else {
    greenPool = green.slice(0, GREEN_FALLBACK_COUNT);
  }
  if (!exhausted) {
    for (const e of greenPool) {
      if (!push(`【世界书·触发】${e.comment || '(未命名)'}：${e.content.slice(0, GREEN_SLICE)}`)) {
        exhausted = true;
        break;
      }
      shown++;
    }
  }
  const remaining = entries.length - shown;
  if (remaining > 0) push(`（其余 ${remaining} 条世界书条目未展示）`);

  /* ---- 正则 / 脚本清单 ---- */
  const ext = (data.extensions ?? {}) as Record<string, unknown>;
  const regexes = (ext.regex_scripts as { scriptName?: string; markdownOnly?: boolean; promptOnly?: boolean }[] | undefined) ?? [];
  if (regexes.length) {
    const list = regexes
      .slice(0, 5)
      .map((r) => `${r.scriptName ?? '(未命名)'}${r.promptOnly ? ' [只发提示词]' : r.markdownOnly ? ' [只渲染]' : ''}`)
      .join('、');
    push(`【正则脚本（前 ${Math.min(5, regexes.length)}/${regexes.length}）】${list}`);
  }
  const scripts = (ext.TavernHelper_scripts as { name?: string }[] | undefined) ?? [];
  if (scripts.length) {
    const list = scripts.slice(0, 5).map((s) => s.name ?? '(未命名)').join('、');
    push(`【酒馆助手脚本（前 ${Math.min(5, scripts.length)}/${scripts.length}）】${list}`);
  }

  return sections.join('\n\n');
}
