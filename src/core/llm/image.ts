/**
 * 生图客户端：
 * 1. OpenAI 兼容 POST /images/generations（b64_json）
 * 2. NovelAI 原生 POST /ai/generate-image（返回 zip 内 png）
 */

import type { ChannelConfig } from './client';

export interface ImageResult {
  /** data URL（data:image/png;base64,…） */
  dataUrl: string;
  revisedPrompt?: string;
}

export async function generateImageOpenAi(
  config: ChannelConfig,
  prompt: string,
  opts: { size?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ImageResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = config.baseUrl.replace(/\/+$/, '');
  const url = /images\/generations$/.test(base) ? base : `${base}/images/generations`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.modelId,
      prompt,
      n: 1,
      size: opts.size ?? '1024x1024',
      response_format: 'b64_json',
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`生图失败 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: { b64_json?: string; revised_prompt?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt };
  if (item?.url) {
    // 少数网关直接给 URL：拉回本地
    const img = await fetchImpl(item.url);
    const buf = new Uint8Array(await img.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(buf).toString('base64');
    return { dataUrl: `data:image/png;base64,${b64}` };
  }
  throw new Error('生图响应中没有 b64_json 或 url');
}

/** NovelAI 原生 /ai/generate-image（zip 里带 png） */
export async function generateImageNovelAi(
  config: ChannelConfig,
  prompt: string,
  negativePrompt = 'lowres, bad, text, error, missing, extra, fewer, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, extra digits, artistic error, username, scan, abstract',
  opts: { size?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ImageResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const [w, h] = (opts.size ?? '832x1216').split('x').map((n) => parseInt(n, 10));
  const res = await fetchImpl('https://image.novelai.net/ai/generate-image', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      action: 'generate',
      input: prompt,
      model: config.modelId || 'nai-diffusion-4-full',
      parameters: {
        params_version: 3,
        width: w || 832,
        height: h || 1216,
        scale: 5,
        sampler: 'k_euler_ancestral',
        steps: 28,
        n_samples: 1,
        ucPreset: 0,
        negative_prompt: negativePrompt,
        qualityToggle: true,
        varietyPlus: true,
      },
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`NovelAI 生图失败 HTTP ${res.status}`);
  const zipBuf = new Uint8Array(await res.arrayBuffer());
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipBuf);
  const pngFile = Object.values(zip.files).find((f) => f.name.endsWith('.png'));
  if (!pngFile) throw new Error('NovelAI 响应 zip 中没有 png');
  const b64 = await pngFile.async('base64');
  return { dataUrl: `data:image/png;base64,${b64}` };
}
