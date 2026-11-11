import { mkdir, lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

const DAY_MS = 86400000;
const leases = new Map();

export function leaseCachePaths(paths) {
  const keys = paths.map(path => resolve(path));
  for (const key of keys) leases.set(key, (leases.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of keys) {
      const count = leases.get(key) - 1;
      if (count) leases.set(key, count); else leases.delete(key);
    }
  };
}

function leased(path) {
  for (const key of leases.keys()) {
    const rel = relative(key, resolve(path));
    if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) return true;
  }
  return false;
}

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
    if (info?.isDirectory() && /^job-[A-Za-z0-9_-]+$/.test(name)) {
      files.push(...await listCacheFiles(path));
      continue;
    }
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
  async function remove(file) {
    if (leased(file.path)) return false;
    try { await unlink(file.path); }
    catch { return false; }
    removed++;
    freed += file.size;
    return true;
  }
  for (const file of files) {
    if (file.mtimeMs < cutoff && await remove(file)) continue;
    keep.push(file);
  }
  let total = keep.reduce((sum, file) => sum + file.size, 0);
  // 超过体积上限时，从最旧的开始删，直到回到上限以内。
  keep.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (let index = 0; total > maxBytes && index < keep.length;) {
    const file = keep[index];
    if (await remove(file)) { total -= file.size; keep.splice(index, 1); }
    else index++;
  }
  // 只删空任务目录，不跟随符号链接，也不递归删除正在使用的文件。
  for (const name of await readdir(dir).catch(() => [])) {
    const path = join(dir, name);
    if (/^job-[A-Za-z0-9_-]+$/.test(name) && !leased(path)) await rmdir(path).catch(() => {});
  }
  return { removed, freed, total, remaining: keep.length };
}

// 启动时先跑一次，之后按 intervalMs 周期执行；定时器 unref，不会拖住进程退出。
export function startCacheJanitor({
  dir, maxBytes, maxAgeDays, intervalMs = 3600000, now = Date.now, onError = () => {}
}) {
  let running;
  const tick = () => running ??= cleanupCache(dir, { maxBytes, maxAgeDays, now: now() }).catch(onError).finally(() => { running = undefined; });
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return async () => { clearInterval(timer); await running; };
}
