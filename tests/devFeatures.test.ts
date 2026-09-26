/** dev 分支新功能集成测试：分类目录 + AI 并发与全局系统提示词 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setStore } from '@/db';
import { MemoryStore } from '@/db/drivers';

setStore(new MemoryStore());

import * as cardService from '@/services/cardService';
import * as categoryService from '@/services/categoryService';
import * as aiService from '@/services/aiService';
import type { AiChannelRow } from '@/services/types';

beforeEach(async () => {
  // 独立用 MemoryStore 每 test 文件一份；这里不复位以保持文件内隔离（用例用不同卡名）
});

describe('分类目录', () => {
  it('建分类 → 归类 → 按分类过滤', async () => {
    const cat = await categoryService.createCategory('主角卡');
    const { row } = await cardService.importCardFromJson({ spec: 'chara_card_v3', data: { name: '分类测试卡A', description: 'x' } });
    await categoryService.assignCategory(row.id, cat.id);
    const updated = await cardService.getCard(row.id);
    expect(updated?.categoryId).toBe(cat.id);
  });

  it('重名分类报错', async () => {
    await categoryService.createCategory('唯一分类名');
    await expect(categoryService.createCategory('唯一分类名')).rejects.toThrow('已存在');
  });

  it('删分类卡片回落未分类（不删卡）', async () => {
    const cat = await categoryService.createCategory('待删分类');
    const { row } = await cardService.importCardFromJson({ spec: 'chara_card_v3', data: { name: '回落测试卡', description: 'x' } });
    await categoryService.assignCategory(row.id, cat.id);
    const r = await categoryService.deleteCategory(cat.id);
    expect(r.movedCards).toBe(1);
    const after = await cardService.getCard(row.id);
    expect(after).toBeDefined();
    expect(after?.categoryId).toBeNull();
  });
});

describe('AI 并发与全局系统提示词', () => {
  it('getSemaphore 默认并发 2', () => {
    const s = aiService.getSemaphore();
    expect(s.limit).toBe(2);
    expect(s.running).toBe(0);
  });

  it('渠道保存带新字段并可读回', async () => {
    const saved = await aiService.saveChannel({
      name: '全局提示渠道',
      kind: 'text',
      provider: 'openai',
      baseUrl: 'https://api.test/v1',
      apiKey: 'k',
      modelId: 'm',
      isActive: true,
      globalSystemPrompt: '输出使用简体中文',
      concurrencyLimit: 3,
    });
    const list = await aiService.listChannels();
    const found = list.find((c) => c.id === saved.id) as AiChannelRow;
    expect(found.globalSystemPrompt).toBe('输出使用简体中文');
    expect(found.concurrencyLimit).toBe(3);
    await aiService.deleteChannel(saved.id);
  });
});
