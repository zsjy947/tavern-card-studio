import { describe, it, expect } from 'vitest';
import { extractJson, stripThinking } from './extract';
import { LlmClient, inspectLlmErrorBody, type ChannelConfig } from './client';

describe('inspectLlmErrorBody', () => {
  it('OpenAI 正常形状返回 null', () => {
    expect(inspectLlmErrorBody({ choices: [{ message: { content: 'hi' } }] })).toBeNull();
  });
  it('旧网关 code/msg 错误体', () => {
    expect(inspectLlmErrorBody({ code: 401, msg: '鉴权失败' })).toBe('401: 鉴权失败');
  });
  it('成功码 code:0/200 不当错误文案', () => {
    // 无 choices 但 code 是成功值：报「缺少 choices」而非「0: success」
    expect(inspectLlmErrorBody({ code: 0, message: 'success' })).toContain('choices');
    expect(inspectLlmErrorBody({ code: '200', message: 'OK' })).toContain('choices');
  });
  it('success:false 错误体', () => {
    expect(inspectLlmErrorBody({ success: false, message: '余额不足' })).toBe('余额不足');
  });
  it('无 choices 且无错误字段 → 提示路径可疑', () => {
    expect(inspectLlmErrorBody({})).toContain('choices');
  });
});

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

  it('testConnection 走最小 chat POST，listModels 走 /models', async () => {
    const client = makeClient((async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] });
      }
      expect(String(url)).toBe('https://example.com/v1/chat/completions');
      expect(init!.method).toBe('POST');
      const body = JSON.parse(String(init!.body));
      expect(body.max_tokens).toBe(5);
      return jsonResponse({ choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }], usage: {} });
    }) as unknown as typeof fetch);
    const r = await client.testConnection();
    expect(r.ok).toBe(true);
    const models = await client.listModels();
    expect(models).toEqual(['m1', 'm2']);
  });

  it('testConnection 未设置模型直接提示', async () => {
    const config: ChannelConfig = {
      id: 't', name: 'test', kind: 'text', baseUrl: 'https://example.com/v1',
      apiKey: 'sk-x', modelId: '', isActive: true,
    };
    const client = new LlmClient(config, (async () => {
      throw new Error('不应发起请求');
    }) as unknown as typeof fetch);
    const r = await client.testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('模型 ID');
  });

  it('HTTP 200 旧网关错误体（code/msg）识别并抛错', async () => {
    const client = makeClient((async () => jsonResponse({ code: 401, msg: '鉴权失败' })) as unknown as typeof fetch);
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], retries: 0 }))
      .rejects.toThrow('401: 鉴权失败');
  });

  it('HTTP 200 error 字段识别并抛错', async () => {
    const client = makeClient((async () => jsonResponse({ error: { message: '配额不足' } })) as unknown as typeof fetch);
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], retries: 0 }))
      .rejects.toThrow('配额不足');
  });

  it('流式响应空文本收尾报错而非静默', async () => {
    const sse = 'data: {"choices":[{}]}\n\ndata: [DONE]\n\n';
    const client = makeClient((async () => new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch);
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], onDelta: () => {}, retries: 0 }))
      .rejects.toThrow('未收到任何文本');
  });

  it('SSE 截断流：结尾无换行的 data 行也被处理', async () => {
    // 无 [DONE]、无结尾换行（截断流常见形态），最后一个事件含 finish_reason 与 usage
    const sse = 'data: {"choices":[{"delta":{"content":"你好"}}]}';
    const client = makeClient((async () => new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch);
    const r = await client.chat({ messages: [{ role: 'user', content: 'x' }], onDelta: () => {}, retries: 0 });
    expect(r.text).toBe('你好');
    expect(r.completionTokens).toBeGreaterThan(0);
  });

  it('超时参数 0 关闭对应超时（非流式 0 = 不限时）', async () => {
    const client = makeClient((async () => jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} })) as unknown as typeof fetch);
    const r = await client.chat({ messages: [{ role: 'user', content: 'x' }], nonStreamTimeoutMs: 0, retries: 0 });
    expect(r.text).toBe('ok');
  });
});
