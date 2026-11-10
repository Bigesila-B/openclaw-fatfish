import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canUse, createPolicyStore, isAdmin, makeAdminCommand } from '../src/permissions.js';

test('QQ identity and channel are both required', () => {
  const admins = ['123456'];
  assert.equal(isAdmin({ channel: 'snowluma', senderId: '123456' }, admins), true);
  assert.equal(isAdmin({ channel: 'other', senderId: '123456' }, admins), false);
  assert.equal(isAdmin({ channel: 'snowluma' }, admins), false);
  assert.equal(canUse({ channel: 'snowluma', senderId: '345678' }, admins, {}, 'image'), false);
  assert.equal(canUse({ channel: 'snowluma', senderId: '345678' }, admins, { image: true }, 'image'), true);
  assert.equal(canUse({ channel: 'other', senderId: '345678' }, admins, { image: true }, 'image'), false);
});

test('help and the bare command list implemented QQ commands without changing permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: ['123456'], store });
  const ctx = { channel: 'snowluma', senderId: '111111', isAuthorizedSender: true };
  const bare = await command.handler({ ...ctx, args: '' });
  const help = await command.handler({ ...ctx, args: 'help' });
  assert.equal(bare.text, help.text);
  for (const name of ['image', 'video', 'sticker', 'permissions', 'allow', 'persona', 'blacklist']) assert.match(help.text, new RegExp(`/fish ${name}`));
  assert.match(help.text, /仅管理员/);
  assert.doesNotMatch(help.text, /\/fish status/);
  assert.deepEqual(await store.read(), { image: false, video: false, watch: false, sticker: false, tts: false });
  assert.match((await command.handler({ ...ctx, isAuthorizedSender: false, args: 'help' })).text, /未通过/);
  assert.match((await command.handler({ ...ctx, senderId: undefined, args: 'help' })).text, /未通过/);
  assert.match((await command.handler({ ...ctx, channel: 'other', args: 'help' })).text, /未通过/);
  assert.match((await command.handler({ ...ctx, args: 'permissions' })).text, /仅限/);
});

test('only authorized admins can change persistent permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: ['123456'], store });
  const base = { channel: 'snowluma', senderId: '123456', isAuthorizedSender: true };
  assert.match((await command.handler({ ...base, senderId: '111111', args: 'allow image on' })).text, /仅限/);
  assert.match((await command.handler({ ...base, isAuthorizedSender: false, args: 'allow image on' })).text, /仅限/);
  assert.deepEqual(await store.read(), { image: false, video: false, watch: false, sticker: false, tts: false });
  await Promise.all([command.handler({ ...base, args: 'allow image on' }), command.handler({ ...base, args: 'allow video on' })]);
  assert.deepEqual(await createPolicyStore(root).read(), { image: true, video: true, watch: false, sticker: false, tts: false });
  await command.handler({ ...base, args: 'allow image off' });
  assert.deepEqual(await store.read(), { image: false, video: true, watch: false, sticker: false, tts: false });
});

test('malformed persisted policies fail closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'fatfish'));
  await writeFile(join(root, 'fatfish', 'permissions.json'), '{"image":true}');
  await assert.rejects(createPolicyStore(root).read(), /格式错误/);
});

test('explicit generation commands enforce the same permission policy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPolicyStore(root);
  let called = 0;
  const command = makeAdminCommand({ admins: ['123456'], store, generate: async (kind, prompt) => { called++; assert.equal(kind, 'image'); assert.equal(prompt, '一条鱼'); return { filePath: '/tmp/fish.png' }; } });
  const ctx = { channel: 'snowluma', senderId: '111111', isAuthorizedSender: true, args: 'image 一条鱼' };
  assert.match((await command.handler(ctx)).text, /没有使用此功能/);
  assert.equal(called, 0);
  await store.set('image', true);
  assert.equal((await command.handler(ctx)).mediaUrl, '/tmp/fish.png');
  assert.equal(called, 1);
});

test('existing policies migrate with video watching disabled and only admins may enable it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'fatfish'));
  await writeFile(join(root, 'fatfish', 'permissions.json'), JSON.stringify({ image: true, video: false }));
  const store = createPolicyStore(root);
  assert.deepEqual(await store.read(), { image: true, video: false, watch: false, sticker: false, tts: false });
  const command = makeAdminCommand({ admins: ['123456'], store });
  const ctx = { channel: 'snowluma', senderId: '111111', isAuthorizedSender: true, args: 'allow watch on' };
  await command.handler(ctx);
  assert.equal(canUse(ctx, ['123456'], await store.read(), 'watch'), false);
  await command.handler({ ...ctx, senderId: '123456' });
  assert.equal(canUse(ctx, ['123456'], await store.read(), 'watch'), true);
});
