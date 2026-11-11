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

test('独立权限按单人、单群、默认继承，账号隔离，inherit 可撤销独立规则', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPolicyStore(root);
  const identity = { channel: 'snowluma', senderId: '345678', accountId: 'a', conversationId: 'group:222222' };
  const scope = { channel: 'snowluma', accountId: 'a' };
  await store.set('image', true, { ...scope, kind: 'group', id: '222222' });
  assert.equal(canUse(identity, [], await store.read(), 'image'), true);
  assert.equal(canUse({ ...identity, accountId: 'b' }, [], await store.read(), 'image'), false);
  await store.set('image', false, { ...scope, kind: 'user', id: identity.senderId });
  assert.equal(canUse(identity, [], await store.read(), 'image'), false);
  assert.equal(canUse(identity, [identity.senderId], await store.read(), 'image'), true);
  const command = makeAdminCommand({ admins: ['123456'], store });
  await command.handler({ ...identity, senderId: '123456', isAuthorizedSender: true, args: `allow image inherit user ${identity.senderId}` });
  assert.equal(canUse(identity, [], await store.read(), 'image'), true);
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
  assert.match(help.text, /\/fish status/);
  assert.deepEqual(await store.read(), { image: false, video: false, watch: false, sticker: false, tts: false, parse: false, stt: false });
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
  assert.deepEqual(await store.read(), { image: false, video: false, watch: false, sticker: false, tts: false, parse: false, stt: false });
  await Promise.all([command.handler({ ...base, args: 'allow image on' }), command.handler({ ...base, args: 'allow video on' })]);
  assert.deepEqual(await createPolicyStore(root).read(), { image: true, video: true, watch: false, sticker: false, tts: false, parse: false, stt: false });
  await command.handler({ ...base, args: 'allow image off' });
  assert.deepEqual(await store.read(), { image: false, video: true, watch: false, sticker: false, tts: false, parse: false, stt: false });
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
  assert.deepEqual(await store.read(), { image: true, video: false, watch: false, sticker: false, tts: false, parse: false, stt: false });
  const command = makeAdminCommand({ admins: ['123456'], store });
  const ctx = { channel: 'snowluma', senderId: '111111', isAuthorizedSender: true, args: 'allow watch on' };
  await command.handler(ctx);
  assert.equal(canUse(ctx, ['123456'], await store.read(), 'watch'), false);
  await command.handler({ ...ctx, senderId: '123456' });
  assert.equal(canUse(ctx, ['123456'], await store.read(), 'watch'), true);
});

// 官方 QQBot 的用户标识是 openid，不是 QQ 号；下面几项确认两种身份都能正常授权。
test('官方 QQBot 的 openid 身份可以当管理员', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const openid = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6';
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: [openid], store });
  const ctx = { channel: 'qqbot', senderId: openid, isAuthorizedSender: true };
  assert.equal(isAdmin({ channel: 'qqbot', senderId: openid }, [openid]), true);
  assert.equal(canUse({ channel: 'qqbot', senderId: openid }, [openid], {}, 'parse'), true);
  assert.match((await command.handler({ ...ctx, args: 'allow parse on' })).text, /已允许/);
  assert.equal((await store.read()).parse, true);
});

test('通道不在可信列表时 openid 也视为不可验证', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const openid = 'A1B2C3D4E5F6A7B8';
  const store = createPolicyStore(root);
  // 只信任 snowluma 时，qqbot 通道的身份必须被拒绝。
  const command = makeAdminCommand({ admins: [openid], store, trustedChannels: ['snowluma'] });
  const reply = await command.handler({ channel: 'qqbot', senderId: openid, isAuthorizedSender: true, args: 'help' });
  assert.match(reply.text, /未通过通道授权/);
  assert.equal(isAdmin({ channel: 'qqbot', senderId: openid }, [openid], ['snowluma']), false);
});

test('/fish whoami 返回通道、标识与会话，且不需要管理员权限', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const openid = 'A1B2C3D4E5F6A7B8';
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: [], store });
  const reply = await command.handler({ channel: 'qqbot', senderId: openid, conversationId: 'c2c:A1B2C3D4E5F6A7B8', isAuthorizedSender: true, args: 'whoami' });
  assert.match(reply.text, /QQ 官方机器人/);
  assert.match(reply.text, new RegExp(openid));
  assert.match(reply.text, /c2c:A1B2C3D4E5F6A7B8/);
  assert.match(reply.text, /管理员：否/);
  assert.match(reply.text, /身份可用：是/);
  // 没有管理员身份也能查，否则新环境永远配不上管理员。
  const anonymous = await command.handler({ channel: 'qqbot', senderId: openid, isAuthorizedSender: true, args: 'whoami' });
  assert.match(anonymous.text, /管理员：否/);
});
