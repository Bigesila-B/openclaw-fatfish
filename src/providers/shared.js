import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LIMIT = 50 * 1024 * 1024;
export function credential(name) {
  const key = process.env[name];
  if (!key || /[\r\n]/.test(key)) throw new Error(`请在 Gateway 环境中设置 ${name}。`);
  return key;
}
export async function jsonRequest(url, key, body, timeout = 120000, fetchFn = fetch, { signal } = {}) {
  let response;
  try { response = await fetchFn(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
  catch { const error = new Error('服务连接失败或超时；服务端可能仍在处理，请勿盲目重试。'); error.ambiguous = Boolean(body); throw error; }
  if (!response.ok) {
    const error = new Error(response.status === 503 ? '服务返回 HTTP 503，当前可能繁忙；请求可能未完成，请稍后检查后手动重试。' : `服务返回 HTTP ${response.status}；请求可能未完成，请检查服务状态和额度。`);
    error.status = response.status; error.ambiguous = Boolean(body) && response.status >= 500;
    throw error;
  }
  const length = Number(response.headers.get('content-length'));
  if (length > LIMIT * 2) throw new Error('服务返回数据过大。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务返回了空响应。');
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT * 2) { await reader.cancel(); throw new Error('服务返回数据过大。'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw new Error('服务返回的数据格式无效。'); }
}
export async function save(data, ext) {
  if (!data.length || data.length > LIMIT) throw new Error('生成文件为空或超过 50 MB。');
  const dir = join(tmpdir(), 'openclaw-fatfish-generated');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = join(dir, `${randomUUID()}.${ext}`);
  await writeFile(filePath, data, { mode: 0o600, flag: 'wx' });
  return filePath;
}
export function decodeBase64(value) {
  if (typeof value !== 'string' || !value || value.length > LIMIT * 4 / 3 + 10 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('服务未返回有效的 Base64 文件。');
  return Buffer.from(value, 'base64');
}
