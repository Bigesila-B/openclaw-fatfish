import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAttachmentRegistry } from '../src/attachments.js';
import { createChatStrategy } from '../src/chat-strategy.js';
import { jsonStore } from '../src/state-store.js';
import { normalizeAudio } from '../src/media-codec.js';

const ctx = { channel: 'snowluma', senderId: '123456', from: 'group:222222', accountId: 'a', sessionKey: 'session' };
async function dir(t) {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-attachments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('附件只读取宿主已暂存媒体，绑定用户、会话、账号，并限制有效期和本地边界', async t => {
  const root = await dir(t);
  await mkdir(join(root, 'media'));
  const path = join(root, 'media', 'audio.wav');
  await writeFile(path, 'RIFFtestWAVEaudio');
  let time = 0, allowed = true;
  const registry = createAttachmentRegistry({ stateDir: root, authorize: async () => allowed, now: () => time });
  registry.capture({ originalMedia: [{ path, kind: 'audio' }] }, ctx);
  assert.deepEqual(registry.list(ctx), []);
  registry.capture({ messageId: 'm', media: [{ path, kind: 'audio' }] }, ctx);
  registry.capture({ messageId: 'm', media: [{ path, kind: 'audio' }] }, ctx);
  assert.equal(registry.list(ctx).length, 1);
  const id = registry.list(ctx)[0].id;
  assert.equal((await registry.read(ctx, 'audio', id)).buffer.toString(), 'RIFFtestWAVEaudio');
  for (const changed of [{ senderId: '654321' }, { accountId: 'b' }, { sessionKey: 'other' }]) await assert.rejects(registry.read({ ...ctx, ...changed }, 'audio', id), /没有当前用户/);
  allowed = false;
  await assert.rejects(registry.read(ctx, 'audio', id), /权限/);
  allowed = true;
  const outside = join(root, 'private.txt'); await writeFile(outside, 'private');
  registry.capture({ media: [{ path: outside, kind: 'audio' }] }, ctx);
  await assert.rejects(registry.read(ctx, 'audio'), /目录/);
  time = 600001;
  assert.deepEqual(registry.list(ctx), []);
});

test('远程附件由安全下载器限大小和重定向，并在读取后再次检查授权', async t => {
  let allowed = true, calls = 0;
  const registry = createAttachmentRegistry({ stateDir: await dir(t), authorize: async () => allowed, fetchMedia: async options => {
    calls++; assert.equal(options.maxRedirects, 0); assert.equal(options.maxBytes, 50 * 1024 ** 2);
    allowed = false; return { buffer: Buffer.from('audio') };
  } });
  registry.capture({ media: [{ url: 'http://example.com/a', kind: 'audio' }] }, ctx);
  await assert.rejects(registry.read(ctx, 'audio'), /安全读取/);
  assert.equal(calls, 0);
  registry.capture({ media: [{ url: 'https://example.com/a', kind: 'audio' }] }, ctx);
  await assert.rejects(registry.read(ctx, 'audio'), /撤销/);
  assert.equal(calls, 1);
});

test('群聊策略默认关闭，不吞指令、明确请求及旧通道已放行消息', async () => {
  assert.equal(await createChatStrategy().before({ content: 'hi', wasMentioned: false }, ctx), undefined);
  const strategy = createChatStrategy({ enabled: true, allowGroups: ['222222'], mode: 'mention' });
  assert.deepEqual(await strategy.before({ content: '闲聊', wasMentioned: false }, ctx), { handled: true });
  for (const event of [{ content: '/fish status' }, { content: '帮我画一条鱼', wasMentioned: false }, { content: 'hi', wasMentioned: true }, { content: '旧通道消息' }]) assert.equal(await strategy.before(event, ctx), undefined);
  assert.equal(await strategy.before({ content: 'hi', wasMentioned: false }, { ...ctx, from: 'group:333333' }), undefined);
});

test('自然群聊合并突发消息，按账号隔离冷却，观察内容可过滤黑名单并过期', async () => {
  let time = 1000;
  const strategy = createChatStrategy({ enabled: true, allowGroups: ['222222'], mode: 'natural', replyProbability: 1, cooldownSeconds: 45, mergeWindowMs: 10 }, { now: () => time, random: () => 0 });
  const first = strategy.before({ content: '第一条', wasMentioned: false, messageId: '1' }, ctx);
  const second = strategy.before({ content: '第二条', wasMentioned: false, messageId: '2' }, ctx);
  assert.deepEqual(await first, { handled: true }); assert.equal(await second, undefined);
  assert.deepEqual(await strategy.before({ content: '重复', wasMentioned: false, messageId: '2' }, ctx), { handled: true });
  assert.deepEqual(await strategy.before({ content: '冷却中', wasMentioned: false }, ctx), { handled: true });
  assert.equal(await strategy.before({ content: '其他机器人', wasMentioned: false }, { ...ctx, accountId: 'b' }), undefined);
  assert.match(strategy.hint(ctx), /第一条/);
  assert.equal(strategy.hint(ctx, ['123456']), '');
  assert.doesNotMatch(strategy.hint({ ...ctx, accountId: 'b' }), /第一条/);
  time += 120001;
  assert.equal(strategy.hint(ctx), '');
});

test('共享状态文件跨实例原子更新，写入失败后仍能继续更新', async t => {
  const file = join(await dir(t), 'state.json');
  const a = jsonStore(file, { count: 0 }), b = jsonStore(file, { count: 0 });
  await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).update(value => { value.count++; })));
  assert.equal((await a.read()).count, 30);
  await assert.rejects(a.update(() => { throw new Error('stop'); }));
  await b.update(value => { value.count++; });
  assert.equal((await a.read()).count, 31);
});

test('没有转换器时音频识别明确降级，不把原始未知格式当作 WAV 上传', async () => {
  await assert.rejects(normalizeAudio(Buffer.from('unsupported'), { ffmpeg: 'fatfish-nonexistent-ffmpeg' }), /无法启动/);
});
