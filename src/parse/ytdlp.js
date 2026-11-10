import { spawn } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// yt-dlp 的 -J 输出可能包含很长的格式列表，给一个上限避免内存被打满。
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

export function runYtdlp(args, { bin = 'yt-dlp', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > MAX_STDOUT) { overflow = true; child.kill(); }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') reject(new Error('未找到 yt-dlp，请先安装并在 parse.ytdlpPath 中配置路径。'));
      else reject(new Error('无法启动 yt-dlp，请检查安装和权限。'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('yt-dlp 执行超时，请缩短视频或稍后重试。'));
      if (overflow) return reject(new Error('yt-dlp 返回的数据过大。'));
      if (code !== 0) return reject(new Error(`yt-dlp 解析失败（退出码 ${code}），链接可能无效或受地区限制。`));
      resolve({ stdout, stderr });
    });
  });
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function normalizeInfo(info, url) {
  if (!info || typeof info !== 'object') throw new Error('yt-dlp 返回的数据格式无效。');
  if (Array.isArray(info.entries)) throw new Error('不支持播放列表或合集链接，请提供单个内容地址。');
  const duration = Number(info.duration);
  return {
    title: text(info.title, 200),
    uploader: text(info.uploader ?? info.channel, 100),
    description: text(info.description, 1000),
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    extractor: text(info.extractor_key ?? info.extractor, 60),
    webpageUrl: typeof url === 'string' ? url : '',
    isLive: info.is_live === true
  };
}

export async function probe(url, { bin, timeoutMs = 60000, run = runYtdlp } = {}) {
  const { stdout } = await run(
    ['-J', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--', url],
    { bin, timeoutMs }
  );
  let info;
  try { info = JSON.parse(stdout); } catch { throw new Error('yt-dlp 返回的数据无法解析。'); }
  return normalizeInfo(info, url);
}

export async function download(url, { bin, dir, maxBytes, timeoutMs = 180000, run = runYtdlp } = {}) {
  const before = new Set(await readdir(dir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  }));
  await run(
    [
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--no-playlist', '--no-warnings', '--no-progress',
      '--restrict-filenames',
      '--max-filesize', String(maxBytes),
      '-o', join(dir, '%(extractor)s-%(id)s.%(ext)s'),
      '--', url
    ],
    { bin, timeoutMs }
  );
  const after = await readdir(dir);
  const files = [];
  for (const name of after) {
    if (before.has(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;
    if (info.size > maxBytes) {
      await unlink(path).catch(() => {});
      throw new Error('下载文件超过大小上限，已删除。');
    }
    files.push({ path, size: info.size });
  }
  if (!files.length) throw new Error('没有下载到可发送的媒体文件。');
  return files;
}
