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
export async function jsonRequest(url, key, body, timeout = 120000, fetchFn = fetch) {
  let response;
  try { response = await fetchFn(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error('服务连接失败或超时；服务端可能仍在处理，请勿盲目重试。'); }
  if (!response.ok) throw new Error(response.status === 503 ? '服务返回 HTTP 503，当前可能繁忙；请求可能未完成，请稍后检查后手动重试。' : `服务返回 HTTP ${response.status}；请求可能未完成，请检查服务状态和额度。`);
  const length = Number(response.headers.get('content-length'));
  if (length > LIMIT * 2) throw new Error('服务返回数据过大。');
  const raw = await response.text();
  if (raw.length > LIMIT * 2) throw new Error('服务返回数据过大。');
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
