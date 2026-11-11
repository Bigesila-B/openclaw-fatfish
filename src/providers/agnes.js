import { setTimeout as delay } from 'node:timers/promises';
import { credential, jsonRequest, save, decodeBase64 } from './shared.js';

const agnes = 'https://api.agnes-ai.cn';

export async function generateAgnes(kind, prompt, options = {}, fetchFn = fetch, controls = {}) {
  if (options.enabled !== true) throw new Error('对应生成功能未启用。');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('提示词须为 1 到 2000 个字符。');
  const key = credential('AGNES_API_KEY');
  const model = options.model || (kind === 'image' ? 'agnes-image-2.5-flash' : 'agnes-video-2.5-flash');
  if (kind === 'image') {
    const result = await jsonRequest(`${agnes}/v1/images/generations`, key, { model, prompt, size: options.size || '1K', return_base64: true }, 120000, fetchFn, controls);
    const data = decodeBase64(result.data?.[0]?.b64_json);
    const ext = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg' : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!ext) throw new Error('服务返回的图片格式不支持。');
    return { filePath: await save(data, ext), kind };
  }
  if (kind !== 'video') throw new Error('不支持的生成类型。');
  // 先确认允许下载的域名，避免创建了付费任务、轮询完成后又因为域名不在白名单而丢弃结果。
  const hosts = Array.isArray(options.allowedDownloadHosts) ? options.allowedDownloadHosts : [];
  if (!hosts.length) throw new Error('视频功能需要先配置 video.allowedDownloadHosts（服务商返回视频的域名），否则任务完成后无法取回结果。');
  const result = await jsonRequest(`${agnes}/v1/videos`, key, { model, prompt, seconds: String(options.seconds ?? 4), mode: 'text', size: '720P', aspect_ratio: '16:9' }, 120000, fetchFn, controls);
  const id = result.video_id;
  if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw new Error('服务没有返回可查询的视频编号，任务可能仍在执行；请勿盲目重试。');
  await controls.onSubmitted?.({ taskId: id, model, provider: 'agnes' });
  return pollAgnesVideo(id, { ...options, model }, fetchFn, controls);
}

export async function pollAgnesVideo(id, options = {}, fetchFn = fetch, controls = {}) {
  if (!/^[\w-]{1,200}$/.test(id)) throw new Error('视频任务编号无效。');
  const key = credential('AGNES_API_KEY');
  const model = options.model || 'agnes-video-2.5-flash';
  const hosts = Array.isArray(options.allowedDownloadHosts) ? options.allowedDownloadHosts : [];
  if (!hosts.length) throw new Error('请先配置 video.allowedDownloadHosts。');
  const deadline = Date.now() + Math.min(Math.max(options.timeoutSeconds ?? 300, 5), 600) * 1000;
  while (Date.now() < deadline) {
    await delay(controls.pollIntervalMs ?? 2000, undefined, { signal: controls.signal });
    const query = new URLSearchParams({ video_id: id, model_name: model });
    let status;
    try { status = await jsonRequest(`${agnes}/agnesapi?${query}`, key, undefined, 15000, fetchFn, controls); }
    catch (error) {
      // 4xx 属于鉴权或参数错误，重试只会耗到超时，直接失败更好排查。
      const httpStatus = Number(/HTTP (\d{3})/.exec(error?.message ?? '')?.[1]);
      if (httpStatus >= 400 && httpStatus < 500) throw error;
      continue; // 轮询是只读的，网络抖动或 5xx 可以继续等，但不会重复创建任务。
    }
    if (status.status === 'failed') { const error = new Error(`视频任务 ${id} 生成失败。`); error.terminal = true; throw error; }
    if (status.status !== 'completed') continue;
    let url; try { url = new URL(status.url); } catch { throw new Error(`视频任务 ${id} 已完成，但未返回有效地址。`); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`视频任务 ${id} 返回了无效的视频地址。`);
    if (!hosts.includes(url.hostname)) throw new Error(`视频任务 ${id} 已完成，视频域名 ${url.hostname} 尚未加入管理员允许列表；请查看云模型教程。`);
    return { filePath: url.href, taskId: id, kind: 'video' };
  }
  throw new Error(`视频任务 ${id} 等待超时；任务可能仍在执行，请勿重复提交。`);
}
