import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractUrls, isSupported } from '../src/parse/detect.js';
import { probe, download, normalizeInfo } from '../src/parse/ytdlp.js';
import { parseMediaLink } from '../src/parse/index.js';

const videoInfo = {
  title: '测试视频', uploader: 'up主', duration: 42, description: '简介',
  extractor_key: 'BiliBili', is_live: false
};

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

  const okRun = async () => {
    await writeFile(join(dir, 'BiliBili-abc.mp4'), Buffer.alloc(1024));
    return { stdout: '', stderr: '' };
  };
  const files = await download('https://www.bilibili.com/video/BV1', { dir, maxBytes: 2048, run: okRun });
  assert.equal(files.length, 1);
  assert.equal(files[0].size, 1024);

  const bigRun = async () => {
    await writeFile(join(dir, 'BiliBili-big.mp4'), Buffer.alloc(4096));
    return { stdout: '', stderr: '' };
  };
  await assert.rejects(download('https://www.bilibili.com/video/BV1', { dir, maxBytes: 2048, run: bigRun }), /超过大小上限/);
  await assert.rejects(stat(join(dir, 'BiliBili-big.mp4')), { code: 'ENOENT' });
});

test('parseMediaLink 汇总标题、媒体数量和总大小', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-parse-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = async args => {
    if (args[0] === '-J') return { stdout: JSON.stringify(videoInfo), stderr: '' };
    await writeFile(join(dir, 'BiliBili-abc.mp4'), Buffer.alloc(2048));
    return { stdout: '', stderr: '' };
  };
  const result = await parseMediaLink('https://www.bilibili.com/video/BV1', { cacheDir: dir, maxBytes: 4096, run });
  assert.match(result.summary, /测试视频/);
  assert.match(result.summary, /1 个文件/);
  assert.equal(result.files.length, 1);
  assert.equal(result.totalBytes, 2048);
  assert.ok(await readFile(result.files[0].path));
});
