import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function generateComfy(prompt, options) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('提示词须为 1 到 2000 个字符。');
  if (options.enabled !== true) throw new Error('对应生成功能未启用。');
  const base = new URL(options.url ?? 'http://127.0.0.1:8188');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('只支持本机 ComfyUI HTTP 地址。');
  if (!options.workflowPath || !options.promptNode || !options.outputNode) throw new Error('请配置工作流路径、提示词节点及输出节点。');
  const raw = await readFile(options.workflowPath, 'utf8');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('工作流文件过大。');
  const graph = JSON.parse(raw);
  const input = graph?.[options.promptNode]?.inputs;
  const key = options.promptInput ?? 'text';
  if (!input || typeof input[key] !== 'string') throw new Error('未找到工作流的文本输入。');
  input[key] = prompt;
  const request = async (path, init = {}) => {
    const response = await fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`);
    return response;
  };
  const submitted = await (await request('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) })).json();
  if (typeof submitted.prompt_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(submitted.prompt_id)) throw new Error('ComfyUI 未返回有效任务编号。');
  const deadline = Date.now() + Math.min(Math.max(options.timeoutSeconds ?? 120, 5), 600) * 1000;
  while (Date.now() < deadline) {
    await delay(1000);
    const data = await (await request(`/history/${submitted.prompt_id}`)).json();
    const record = data[submitted.prompt_id];
    if (!record) continue;
    if (record.status?.status_str === 'error') throw new Error(`ComfyUI 工作流执行失败（任务 ${submitted.prompt_id}）。`);
    if (!record.status?.completed && !record.outputs) continue;
    const output = record.outputs?.[options.outputNode];
    const entries = [...(output?.images ?? []), ...(output?.gifs ?? []), ...(output?.videos ?? [])];
    const found = entries.find(item => typeof item.filename === 'string' && item.type === 'output' && typeof (item.subfolder ?? '') === 'string');
    if (!found) throw new Error(`工作流没有返回指定输出节点的文件（任务 ${submitted.prompt_id}）。`);
    const extension = found.filename.split('.').pop()?.toLowerCase();
    const allowed = options.kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : ['mp4', 'webm'];
    if (!allowed.includes(extension)) throw new Error('工作流输出格式不支持。');
    const query = new URLSearchParams({ filename: found.filename, subfolder: found.subfolder ?? '', type: 'output' });
    const response = await request(`/view?${query}`);
    const length = Number(response.headers.get('content-length'));
    const max = 50 * 1024 * 1024;
    if (Number.isFinite(length) && length > max) throw new Error('生成文件超过 50 MB 上限。');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) throw new Error('生成文件超过 50 MB 上限。');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw new Error('生成文件为空。');
    const dir = join(tmpdir(), 'openclaw-fatfish-generated');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const filePath = join(dir, `${randomUUID()}.${extension}`);
    await writeFile(filePath, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
    return { filePath, taskId: submitted.prompt_id, kind: options.kind };
  }
  throw new Error(`等待生成超时。ComfyUI 任务可能仍在执行（任务 ${submitted.prompt_id}），请勿盲目重复提交。`);
}
