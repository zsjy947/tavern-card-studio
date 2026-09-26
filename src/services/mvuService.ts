/**
 * MVU 服务：变量套装落卡编排（消毒 → 保存 → 快照）。
 * 核心构建逻辑在 core/mvu（纯函数可单测），本层负责持久化与版本快照。
 */
import * as cardService from './cardService';
import type { AnyCard, MvuVarGroup } from '@/core/card';
import { applyMvuToCard, detectExistingMvu, removeExistingMvu, MVU_DEFAULT_CONFIG, type MvuSuiteConfig } from '@/core/mvu/suite';
import { buildZodCode } from '@/core/mvu/model';

/** 注入 MVU 13 件套（幂等；返回更新后的卡行） */
export async function applyMvuSuite(
  cardId: string,
  groups: MvuVarGroup[],
  config: MvuSuiteConfig = MVU_DEFAULT_CONFIG,
  opts: { zodCode?: string } = {},
): Promise<AnyCard> {
  const row = await cardService.getCard(cardId);
  if (!row) throw new Error(`卡不存在：${cardId}`);
  const zodCode = opts.zodCode ?? buildZodCode(groups, config);
  const next = applyMvuToCard(row.card, groups, zodCode, config);
  await cardService.saveCard(cardId, next, { note: 'MVU 套装注入', forceSnapshot: true });
  return next;
}

/** 清空卡内全部 MVU 内容（幂等清理） */
export async function clearMvu(cardId: string): Promise<AnyCard> {
  const row = await cardService.getCard(cardId);
  if (!row) throw new Error(`卡不存在：${cardId}`);
  const next = removeExistingMvu(row.card);
  await cardService.saveCard(cardId, next, { note: '清空 MVU 套装', forceSnapshot: true });
  return next;
}

/** 检测卡内是否已有 MVU（UI 提示「替换」用） */
export async function hasMvu(cardId: string): Promise<boolean> {
  const row = await cardService.getCard(cardId);
  return row ? detectExistingMvu(row.card) : false;
}
