import { describe, it, expect } from 'vitest';
import { extractJson, stripThinking } from './extract';
import { LlmClient, type ChannelConfig } from './client';

describe('stripThinking', () => {
  it('剥离思考标签', () => {
    expect(stripThinking('<think>推理过程</think>答案')).toBe('答案');
    expect(stripThinking('前<think>a</think>中<analysis>b</analysis>后')).toBe('前中后');
    expect(stripThinking('无标签')).toBe('无标签');
  });
});

describe('extractJson 鲁棒抽取', () => {
  it('裸 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('```json 代码块', () => {
    expect(extractJson('结果如下：\n```json\n{"a": [1,2]}\n```\n完')).toEqual({ a: [1, 2] });
  });

  it('前后缀噪声中平衡抽取', () => {
    expect(extractJson('好的，这是结果 {"name": "甲", "nested": {"x": 1}} 请查收')).toEqual({ name: '甲', nested: { x: 1 } });
  });

  it('字符串内的括号不干扰平衡', () => {
    expect(extractJson('{"s": "包含 } 和 { 的字符串"}')).toEqual({ s: '包含 } 和 { 的字符串' });
  });

  it('数组抽取', () => {
    expect(extractJson('输出：[{"k":1},{"k":2}]')).toEqual([{ k: 1 }, { k: 2 }]);
  });

  it('思考标签 + 代码块叠加', () => {
    expect(extractJson('<think>想想</think>```json\n{"ok": true}\n```')).toEqual({ ok: true });
  });

  it('尾逗号修复', () => {
    expect(extractJson('```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
  });

  it('无 JSON 时抛错', () => {
    expect(() => extractJson('没有任何结构化内容')).toThrow();
  });
});

/* ---------------- LlmClient（mock fetch） ---------------- */

function makeClient(fetchImpl: typeof fetch): LlmClient {
  const config: ChannelConfig = {
    id: 't', name: 'test', kind: 'text', baseUrl: 'https://example.com/v1',
    apiKey: 'sk-x', modelId: 'gpt-test', isActive: true,
  };
  return new LlmClient(config, fetchImpl);
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

describe('LlmClient', () => {
  it('普通 chat 调用与用量', async () => {
    const client = makeClient((async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body.model).toBe('gpt-test');
      expect(body.messages).toHaveLength(1);
      expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-x');
      return jsonResponse({
        choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as unknown as typeof fetch);
    const r = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('你好');
    expect(r.promptTokens).toBe(10);
  });

  it('429 重试后成功', async () => {
    let calls = 0;
    const client = makeClient((async () => {
      calls++;
      if (calls < 3) return new Response('rate limit', { status: 429 });
      return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} });
    }) as unknown as typeof fetch);
    const r = await client.chat({ messages: [{ role: 'user', content: 'x' }], retries: 3 });
    expect(r.text).toBe('ok');
    expect(calls).toBe(3);
  });

  it('4xx 不重试直接抛错', async () => {
    let calls = 0;
    const client = makeClient((async () => {
      calls++;
      return new Response('bad key', { status: 401 });
    }) as unknown as typeof fetch);
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('finish_reason=length 自动续写拼接', async () => {
    const client = makeClient((async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      const isContinue = body.messages.length > 1;
      return jsonResponse({
        choices: [{
          message: { content: isContinue ? '世界' : '你好，' },
          finish_reason: isContinue ? 'stop' : 'length',
        }],
        usage: {},
      });
    }) as unknown as typeof fetch);
    const r = await client.chat({ messages: [{ role: 'user', content: 'x' }], maxContinues: 2 });
    expect(r.text).toBe('你好，世界');
  });

  it('json 模式自动抽取', async () => {
    const client = makeClient((async () => jsonResponse({
      choices: [{ message: { content: '```json\n{"score": 88}\n```' }, finish_reason: 'stop' }], usage: {},
    })) as unknown as typeof fetch);
    const r = await client.chatJson<{ score: number }>({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.score).toBe(88);
  });

  it('testConnection 走 /models', async () => {
    const client = makeClient((async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://example.com/v1/models');
      return jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] });
    }) as unknown as typeof fetch);
    const r = await client.testConnection();
    expect(r.ok).toBe(true);
    const models = await client.listModels();
    expect(models).toEqual(['m1', 'm2']);
  });
});
