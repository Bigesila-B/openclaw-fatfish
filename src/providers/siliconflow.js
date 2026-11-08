import { LIMIT, credential } from './shared.js';

export async function transcribeSilicon(req) {
  const key = req.auth?.kind === 'api-key' ? req.auth.apiKey : req.apiKey || credential('SILICONFLOW_API_KEY');
  if (!req.buffer?.length || req.buffer.length > LIMIT) throw new Error('音频为空或超过 50 MB。');
  const form = new FormData();
  form.append('file', new Blob([req.buffer], { type: req.mime || 'application/octet-stream' }), req.fileName || 'audio.wav');
  const model = req.model || 'TeleAI/TeleSpeechASR';
  form.append('model', model);
  const response = await (req.fetchFn || fetch)('https://api.siliconflow.cn/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(req.timeoutMs || 120000) });
  if (!response.ok) throw new Error(`硅基流动转写返回 HTTP ${response.status}。`);
  const result = await response.json();
  if (typeof result.text !== 'string') throw new Error('硅基流动没有返回转写文本。');
  return { text: result.text, model };
}
