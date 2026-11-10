import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  pickAsset, resolveRelease, expectedDigest, assertSafeEntries, installSnowluma
} from '../src/snowluma-install.js';

const asset = name => ({ name, browser_download_url: `https://example.test/${name}` });
const releaseJson = {
  tag_name: 'v2.4.2',
  assets: [asset('SnowLuma-v2.4.2-linux-x64.tar.gz'), asset('checksums.sha256')]
};

test('pickAsset 选择对应平台的非 lite 包', () => {
  const assets = [
    asset('SnowLuma-v2.4.2-linux-x64-lite.tar.gz'),
    asset('SnowLuma-v2.4.2-linux-x64.tar.gz'),
    asset('SnowLuma-v2.4.2-win-x64.zip')
  ];
  assert.equal(pickAsset(assets, 'linux', 'x64').name, 'SnowLuma-v2.4.2-linux-x64.tar.gz');
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'SnowLuma-v2.4.2-win-x64.zip');
  assert.equal(pickAsset(assets, 'linux', 'arm64'), null);
});

test('官方仓库 404 时回退到备用仓库', async () => {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    if (url.includes('/repos/SnowLuma/SnowLuma/')) return new Response('', { status: 404 });
    return new Response(JSON.stringify(releaseJson), { status: 200 });
  };
  const release = await resolveRelease({ fetchFn, platform: 'linux', arch: 'x64' });
  assert.equal(release.source, 'Bigesila-B/SnowLuma');
  assert.equal(release.tag, 'v2.4.2');
  assert.equal(release.checksums.name, 'checksums.sha256');
  assert.equal(calls.length, 2);
});

test('所有来源都不可用时列出已尝试的仓库', async () => {
  const fetchFn = async () => new Response('', { status: 404 });
  await assert.rejects(
    resolveRelease({ fetchFn, platform: 'linux', arch: 'x64' }),
    /已尝试.*SnowLuma\/SnowLuma.*Bigesila-B\/SnowLuma/
  );
});

test('摘要解析与不安全路径拒绝', () => {
  const digest = 'a'.repeat(64);
  assert.equal(expectedDigest(`${digest}  SnowLuma-v2.4.2-linux-x64.tar.gz\n`, 'SnowLuma-v2.4.2-linux-x64.tar.gz'), digest);
  assert.equal(expectedDigest('', 'x'), null);
  assert.throws(() => assertSafeEntries(['ok/file', '../evil']), /不安全/);
  assert.throws(() => assertSafeEntries(['/etc/passwd']), /不安全/);
  assert.throws(() => assertSafeEntries(['C:/Windows/system32']), /不安全/);
  assert.doesNotThrow(() => assertSafeEntries(['launcher.sh', 'index.mjs']));
});

test('安装成功后校验摘要并替换目录', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-snowluma-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'app');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'old.txt'), 'old');

  const payload = Buffer.from('fake-archive');
  const digest = createHash('sha256').update(payload).digest('hex');
  const fetchFn = async url => {
    if (url.endsWith('checksums.sha256')) return new Response(`${digest}  SnowLuma-v2.4.2-linux-x64.tar.gz\n`);
    if (url.includes('/releases/latest')) return new Response(JSON.stringify(releaseJson));
    return new Response(payload);
  };
  const run = async (command, args) => {
    if (command === 'tar' && args[0] === '-tf') return { stdout: 'launcher.sh\nindex.mjs\n', stderr: '' };
    if (command === 'tar' && args[0] === '-xf') {
      const target = args[args.indexOf('-C') + 1];
      await writeFile(join(target, 'launcher.sh'), '#!/bin/sh\n');
      await writeFile(join(target, 'index.mjs'), '// runtime\n');
    }
    return { stdout: '', stderr: '' };
  };

  const result = await installSnowluma({ dir, fetchFn, run, platform: 'linux', arch: 'x64' });
  assert.equal(result.verified, true);
  assert.equal(result.tag, 'v2.4.2');
  assert.equal(await readFile(join(dir, 'launcher.sh'), 'utf8'), '#!/bin/sh\n');
  await assert.rejects(readFile(join(dir, 'old.txt')), { code: 'ENOENT' });
});

test('摘要不匹配时中止且保留原有安装', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-snowluma-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'app');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'keep.txt'), 'keep');

  const fetchFn = async url => {
    if (url.endsWith('checksums.sha256')) return new Response(`${'b'.repeat(64)}  SnowLuma-v2.4.2-linux-x64.tar.gz\n`);
    if (url.includes('/releases/latest')) return new Response(JSON.stringify(releaseJson));
    return new Response(Buffer.from('tampered'));
  };
  const run = async () => ({ stdout: 'launcher.sh\n', stderr: '' });

  await assert.rejects(installSnowluma({ dir, fetchFn, run, platform: 'linux', arch: 'x64' }), /不一致/);
  assert.equal(await readFile(join(dir, 'keep.txt'), 'utf8'), 'keep');
});
