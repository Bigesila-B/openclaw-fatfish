import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupCache, startCacheJanitor } from '../src/media-cache.js';

const DAY = 86400000;

async function aged(dir, name, bytes, daysAgo) {
  const path = join(dir, name);
  await writeFile(path, Buffer.alloc(bytes));
  const when = new Date(Date.now() - daysAgo * DAY);
  await utimes(path, when, when);
  return path;
}

test('按年龄删除过期缓存，保留新文件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await aged(dir, 'old.mp4', 100, 8);
  await aged(dir, 'fresh.mp4', 100, 1);

  const result = await cleanupCache(dir, { maxBytes: 1024 * 1024, maxAgeDays: 7 });
  assert.equal(result.removed, 1);
  assert.deepEqual(await readdir(dir), ['fresh.mp4']);
});

test('超过体积上限时从最旧的文件开始删到上限以内', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await aged(dir, 'a.mp4', 400, 3);
  await aged(dir, 'b.mp4', 400, 2);
  await aged(dir, 'c.mp4', 400, 1);

  const result = await cleanupCache(dir, { maxBytes: 1000, maxAgeDays: 30 });
  assert.equal(result.removed, 1, '只需删除最旧的一个文件');
  assert.equal(result.total, 800);
  assert.deepEqual((await readdir(dir)).sort(), ['b.mp4', 'c.mp4']);
});

test('清理器启动时立即执行一次，并能停止', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await aged(dir, 'old.mp4', 100, 30);

  const stop = startCacheJanitor({ dir, maxBytes: 1024 * 1024, maxAgeDays: 7, intervalMs: 60000 });
  await new Promise(resolve => setTimeout(resolve, 60));
  stop();

  assert.deepEqual(await readdir(dir), []);
});

test('缓存目录不存在时清理不报错', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await cleanupCache(join(dir, 'missing'), {});
  assert.equal(result.removed, 0);
  assert.equal(result.total, 0);
});
