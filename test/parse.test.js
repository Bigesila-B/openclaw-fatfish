import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { extractUrls, isSupported } from '../src/parse/detect.js';
import { probe, download, normalizeInfo } from '../src/parse/ytdlp.js';
import { parseMediaLink } from '../src/parse/index.js';
import { cleanupCache, leaseCachePaths } from '../src/media-cache.js';

const videoInfo = {
  title: '测试视频', uploader: 'up主', duration: 42, description: '简介',
  extractor_key: 'BiliBili', is_live: false
};

async function downloaded(args, name, size) {
  const path = join(dirname(args[args.indexOf('-o') + 1]), name);
  await writeFile(path, Buffer.alloc(size));
  return { stdout: JSON.stringify(path) + '\n', stderr: '' };
}

test('只识别受支持的公开平台链接', () => {
  const text = '看这个 https://www.bilibili.com/video/BV1xx411c7mD?p=1，还有 https://example.com/a。';
  assert.deepEqual(extractUrls(text), [
    'https://www.bilibili.com/video/BV1xx411c7mD?p=1',
    'https://example.com/a'
  ]);
  assert.equal(isSupported('https://www.bilibili.com/video/BV1xx'), true);
  assert.equal(isSupported('https://b23.tv/abc'), true);
  assert.equal(isSupported('https://example.com/a'), false);
  assert.equal(isSupported('http://127.0.0.1/a'), false);
  assert.equal(isSupported('file:///etc/passwd'), false);
  assert.equal(isSupported('https://user:pass@youtube.com/watch?v=1'), false);
  // 仅靠后缀匹配不能放行仿冒域名
  assert.equal(isSupported('https://evilbilibili.com/a'), false);
});

test('probe 使用参数数组调用 yt-dlp 并规范化元数据', async () => {
  let seen;
  const run = async args => {
    seen = args;
    return { stdout: JSON.stringify(videoInfo), stderr: '' };
  };
  const info = await probe('https://www.bilibili.com/video/BV1xx', { run });
  assert.equal(seen[0], '-J');
  assert.equal(seen.at(-1), 'https://www.bilibili.com/video/BV1xx');
  assert.equal(seen.includes('--no-playlist'), true);
  assert.deepEqual(info, {
    title: '测试视频', uploader: 'up主', description: '简介', duration: 42,
    extractor: 'BiliBili', webpageUrl: 'https://www.bilibili.com/video/BV1xx', isLive: false
  });
});

test('配置 Cookie 文件时传给 yt-dlp', async () => {
  let seen;
  const run = async args => { seen = args; return { stdout: JSON.stringify(videoInfo), stderr: '' }; };
  await probe('https://www.bilibili.com/video/BV1xx', { run, cookiesFile: '/tmp/cookies.txt' });
  const index = seen.indexOf('--cookies');
  assert.notEqual(index, -1);
  assert.equal(seen[index + 1], '/tmp/cookies.txt');
});

test('拒绝播放列表和直播', async () => {
  assert.throws(() => normalizeInfo({ entries: [] }, 'https://x'), /播放列表/);
  const playlistRun = async () => ({ stdout: JSON.stringify({ entries: [{ id: 1 }] }), stderr: '' });
  await assert.rejects(parseMediaLink('https://www.bilibili.com/video/BV1', { cacheDir: '/tmp', maxBytes: 1024, run: playlistRun }), /播放列表/);

  const liveRun = async () => ({ stdout: JSON.stringify({ ...videoInfo, is_live: true }), stderr: '' });
  await assert.rejects(parseMediaLink('https://www.bilibili.com/video/BV1', { cacheDir: '/tmp', maxBytes: 1024, run: liveRun }), /直播/);
});

test('超出时长上限时不下载', async () => {
  let downloads = 0;
  const run = async args => {
    if (args[0] === '-J') return { stdout: JSON.stringify({ ...videoInfo, duration: 999 }), stderr: '' };
    downloads++;
    return { stdout: '', stderr: '' };
  };
  await assert.rejects(
    parseMediaLink('https://www.bilibili.com/video/BV1', { cacheDir: '/tmp', maxBytes: 1024, maxDurationSeconds: 60, run }),
    /超过上限/
  );
  assert.equal(downloads, 0);
});

test('下载后校验大小，超限文件会被删除', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const okRun = args => downloaded(args, 'BiliBili-abc.mp4', 1024);
  const files = await download('https://www.bilibili.com/video/BV1', { dir, maxBytes: 2048, run: okRun });
  assert.equal(files.length, 1);
  assert.equal(files[0].size, 1024);

  let oversized;
  const bigRun = async args => {
    const result = await downloaded(args, 'BiliBili-big.mp4', 4096);
    oversized = JSON.parse(result.stdout);
    return result;
  };
  await assert.rejects(download('https://www.bilibili.com/video/BV2', { dir, maxBytes: 2048, run: bigRun }), /超过大小上限/);
  await assert.rejects(stat(oversized), { code: 'ENOENT' });
});

test('parseMediaLink 汇总标题、媒体数量和总大小', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = async args => {
    if (args[0] === '-J') return { stdout: JSON.stringify(videoInfo), stderr: '' };
    return downloaded(args, 'BiliBili-abc.mp4', 2048);
  };
  const result = await parseMediaLink('https://www.bilibili.com/video/BV1', { cacheDir: dir, maxBytes: 4096, run });
  assert.match(result.summary, /测试视频/);
  assert.match(result.summary, /1 个文件/);
  assert.equal(result.files.length, 1);
  assert.equal(result.totalBytes, 2048);
  assert.ok(await readFile(result.files[0].path));
});

test('重复链接复用有效缓存，不会误报没有文件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const run = args => { calls++; return downloaded(args, 'same.mp4', 10); };
  const first = await download('https://example.test/a', { dir, maxBytes: 100, run });
  assert.deepEqual(await download('https://example.test/a', { dir, maxBytes: 100, run }), first);
  assert.equal(calls, 1);
  await rm(first[0].path);
  const refreshed = await download('https://example.test/a', { dir, maxBytes: 100, run });
  assert.equal(calls, 2, '缓存被清理后可以重新下载');
  assert.notEqual(refreshed[0].path, first[0].path);
});

test('并发请求隔离文件，同链接并发只下载一次', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const run = async args => {
    const result = await downloaded(args, args.at(-1).endsWith('/a') ? 'a.mp4' : 'b.mp4', 10);
    if (++arrivals === 2) release();
    await barrier;
    return result;
  };
  const [a, b, aAgain] = await Promise.all(['a', 'b', 'a'].map(id => download(`https://example.test/${id}`, { dir, maxBytes: 100, run })));
  assert.equal(arrivals, 2);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(dirname(a[0].path), dirname(b[0].path));
  assert.deepEqual(aAgain, a);
});

test('拒绝清单越界、半成品以及累计超限，失败清理任务目录', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = join(dir, 'unrelated.mp4');
  await writeFile(outside, 'private');
  await assert.rejects(download('https://example.test/outside', { dir, maxBytes: 100, run: async () => ({ stdout: JSON.stringify(outside) }) }), /无效/);
  await assert.rejects(download('https://example.test/part', { dir, maxBytes: 100, run: args => downloaded(args, 'x.mp4.part', 10) }), /无效/);
  await assert.rejects(download('https://example.test/total', { dir, maxBytes: 100, run: async args => {
    const a = await downloaded(args, 'a.mp4', 60), b = await downloaded(args, 'b.mp4', 60);
    return { stdout: a.stdout + b.stdout };
  } }), /超过大小上限/);
  assert.deepEqual(await readdir(dir), ['unrelated.mp4']);
  assert.equal(await readFile(outside, 'utf8'), 'private');
});

test('缓存根目录的路径别名不会被误判为越界，文件仍限定在真实任务目录', async t => {
  const base = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const physical = join(base, 'physical'), alias = join(base, 'alias');
  await mkdir(physical);
  await symlink(await realpath(physical), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const files = await download('https://example.test/alias', { dir: alias, maxBytes: 100, run: args => downloaded(args, 'valid.mp4', 10) });
  assert.equal(files.length, 1);
  assert.ok(dirname(files[0].path).startsWith(await realpath(physical)));
  assert.equal(await readFile(files[0].path).then(value => value.length), 10);
  const release = leaseCachePaths([join(alias, relative(await realpath(physical), files[0].path))]);
  try {
    await cleanupCache(physical, { maxBytes: 0, maxAgeDays: 0 });
    assert.equal((await stat(files[0].path)).size, 10, '从别名取得的租约也保护真实路径');
  } finally { release(); }
});
