import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { leaseCachePaths } from '../media-cache.js';

// yt-dlp 的 -J 输出可能包含很长的格式列表，给一个上限避免内存被打满。
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const downloads = new Map();
const mediaExtensions = new Set(['.mp4', '.mkv', '.webm', '.mov', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.flac', '.jpg', '.jpeg', '.png', '.webp', '.gif']);

function inside(root, path) {
  const rel = relative(root, path);
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

async function validateFiles(root, paths, maxBytes) {
  const files = [];
  let total = 0;
  for (const path of [...new Set(paths)]) {
    if (!isAbsolute(path) || !inside(root, path) || !mediaExtensions.has(extname(path).toLowerCase())) throw new Error('下载器返回了无效的媒体文件。');
    const info = await lstat(path);
    if (!info.isFile() || !inside(root, await realpath(path))) throw new Error('下载器返回了无效的媒体文件。');
    total += info.size;
    if (!info.size) throw new Error('下载的媒体文件为空。');
    if (total > maxBytes) throw new Error('下载文件超过大小上限，已删除。');
    files.push({ path, size: info.size });
  }
  if (!files.length) throw new Error('没有下载到可发送的媒体文件。');
  return files;
}

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

export async function probe(url, { bin, timeoutMs = 60000, run = runYtdlp, cookiesFile } = {}) {
  const args = ['-J', '--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '15'];
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push('--', url);
  const { stdout } = await run(args, { bin, timeoutMs });
  let info;
  try { info = JSON.parse(stdout); } catch { throw new Error('yt-dlp 返回的数据无法解析。'); }
  return normalizeInfo(info, url);
}

export async function download(url, { bin, dir, maxBytes, timeoutMs = 180000, run = runYtdlp, cookiesFile } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('媒体大小上限无效。');
  const root = resolve(dir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Cookie 变化后不复用旧结果；URL 只保存摘要，不把带签名的链接写入缓存清单。
  const cookieVersion = cookiesFile ? await lstat(cookiesFile).then(s => `${cookiesFile}:${s.size}:${s.mtimeMs}`) : '';
  const key = createHash('sha256').update(`${url}\n${cookieVersion}`).digest('hex');
  const manifest = join(root, `${key}.json`);
  const flightKey = `${root}:${key}:${maxBytes}`;
  if (downloads.has(flightKey)) return downloads.get(flightKey);
  const work = async () => {
    try {
      const cached = JSON.parse(await readFile(manifest, 'utf8'));
      if (cached.version === 1 && Array.isArray(cached.files) && cached.files.length <= 16) {
        const files = await validateFiles(root, cached.files.map(path => resolve(root, path)), maxBytes);
        const now = new Date();
        await Promise.all([...files.map(file => utimes(file.path, now, now)), utimes(manifest, now, now)]);
        return files;
      }
    } catch { /* 缓存过期、文件已清理或大小限制变化时，重新下载。 */ }
    const jobDir = await mkdtemp(join(root, 'job-'));
    const temporary = `${manifest}.${randomUUID()}.tmp`;
    const release = leaseCachePaths([jobDir, manifest, temporary]);
    let published = false;
    try {
      const args = [
        '-f', 'bv*+ba/b',
        '--merge-output-format', 'mp4',
        '--ignore-config', '--no-playlist', '--no-warnings', '--no-progress',
        '--restrict-filenames', '--no-simulate',
        '--print', 'after_move:%(filepath)j',
        '--max-filesize', String(maxBytes)
      ];
      if (cookiesFile) args.push('--cookies', cookiesFile);
      args.push('-o', join(jobDir, '%(extractor)s-%(id)s.%(ext)s'), '--', url);
      const { stdout } = await run(args, { bin, timeoutMs });
      let paths;
      try { paths = stdout.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
      catch { throw new Error('下载器未返回有效的媒体清单，请更新 yt-dlp。'); }
      if (paths.length > 16) throw new Error('下载的媒体数量超过上限。');
      const files = await validateFiles(jobDir, paths, maxBytes);
      await writeFile(temporary, JSON.stringify({ version: 1, files: files.map(file => relative(root, file.path)) }), { mode: 0o600, flag: 'wx' });
      await rename(temporary, manifest);
      published = true;
      return files;
    } finally {
      release();
      await rm(temporary, { force: true });
      if (!published) await rm(jobDir, { recursive: true, force: true });
    }
  };
  const promise = work();
  downloads.set(flightKey, promise);
  try { return await promise; }
  finally { downloads.delete(flightKey); }
}
