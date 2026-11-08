import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStickerStore, createStickerCooldown } from '../src/stickers.js';
import { createPolicyStore, makeAdminCommand } from '../src/permissions.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

test('imports, deduplicates, searches and removes bounded sticker files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-sticker-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'face.png'); await writeFile(input, png);
  const store = createStickerStore(root, 1);
  const first = await store.add(input, '开心的小鱼', ['开心', '打招呼']);
  assert.equal(first.added, true);
  assert.equal((await store.add(input, '重复图片', [])).added, false);
  assert.equal((await store.search('表示开心'))[0].id, first.item.id);
  assert.deepEqual(await store.search('宇宙飞船'), []);
  assert.ok((await store.get(first.item.id)).filePath.endsWith('.png'));
  const other = join(root, 'other.png'); await writeFile(other, Buffer.concat([png, Buffer.from('2')]));
  await assert.rejects(store.add(other, '另一张'), /已满/);
  assert.equal(await store.remove(first.item.id), true);
  assert.equal(await store.get(first.item.id), null);
  await assert.rejects(store.add(other, 'bad\ntext'), /换行/);
  const bad = join(root, 'bad.png'); await writeFile(bad, 'not an image');
  await assert.rejects(store.add(bad, '错误图片'), /仅支持/);
});

test('sticker cooldown is per conversation', () => {
  let time = 1000;
  const allowed = createStickerCooldown(60, () => time);
  assert.equal(allowed('group:one'), true);
  assert.equal(allowed('group:one'), false);
  assert.equal(allowed('group:two'), true);
  time += 60000;
  assert.equal(allowed('group:one'), true);
  assert.throws(() => allowed(''), /会话/);
});

test('QQ sticker command respects permissions and returns a media payload', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-sticker-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'face.png'); await writeFile(input, png);
  const stickers = createStickerStore(root); await stickers.add(input, '快乐', ['开心']);
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: ['123456'], store, stickerStore: stickers, stickerCooldown: createStickerCooldown(60), stickerConfig: { enabled: true } });
  const ctx = { channel: 'snowluma', senderId: '111111', isAuthorizedSender: true, from: 'group:123456', args: 'sticker 开心' };
  assert.match((await command.handler(ctx)).text, /没有使用/);
  await store.set('sticker', true);
  assert.match((await command.handler(ctx)).mediaUrl, /\.png$/);
  assert.match((await command.handler(ctx)).text, /频繁/);
});
