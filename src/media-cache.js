import { mkdir, lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 86400000;

export function parseCacheDir(stateDir) {
  return join(stateDir, 'fatfish', 'cache', 'media');
}

export async function ensureCacheDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// 只统计目录下的普通文件；遇到符号链接按文件处理（unlink 不会影响链接目标）。
export async function listCacheFiles(dir) {
  let names;
  try { names = await readdir(dir); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const name of names) {
    const path = join(dir, name);
    const info = await lstat(path).catch(() => null);
    if (!info || !(info.isFile() || info.isSymbolicLink())) continue;
    files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
  }
  return files;
}

export async function cleanupCache(dir, { maxBytes = 1024 ** 3, maxAgeDays = 7, now = Date.now() } = {}) {
  const files = await listCacheFiles(dir);
  const cutoff = now - maxAgeDays * DAY_MS;
  let removed = 0, freed = 0;
  const keep = [];
  for (const file of files) {
    if (file.mtimeMs < cutoff) {
      await unlink(file.path).catch(() => {});
      removed++;
      freed += file.size;
    } else {
      keep.push(file);
    }
  }
  let total = keep.reduce((sum, file) => sum + file.size, 0);
  // 超过体积上限时，从最旧的开始删，直到回到上限以内。
  keep.sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (total > maxBytes && keep.length) {
    const file = keep.shift();
    await unlink(file.path).catch(() => {});
    total -= file.size;
    removed++;
    freed += file.size;
  }
  return { removed, freed, total, remaining: keep.length };
}

// 启动时先跑一次，之后按 intervalMs 周期执行；定时器 unref，不会拖住进程退出。
export function startCacheJanitor({
  dir, maxBytes, maxAgeDays, intervalMs = 3600000, now = Date.now, onError = () => {}
}) {
  const tick = () => cleanupCache(dir, { maxBytes, maxAgeDays, now: now() }).catch(onError);
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
