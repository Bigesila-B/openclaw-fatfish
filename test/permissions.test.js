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

test('only authorized admins can change persistent permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-policy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPolicyStore(root);
  const command = makeAdminCommand({ admins: ['123456'], store });
  const base = { channel: 'snowluma', senderId: '123456', isAuthorizedSender: true };
  assert.match((await command.handler({ ...base, senderId: '111111', args: 'allow image on' })).text, /仅限/);
  assert.match((await command.handler({ ...base, isAuthorizedSender: false, args: 'allow image on' })).text, /仅限/);
  assert.deepEqual(await store.read(), { image: false, video: false });
  await Promise.all([command.handler({ ...base, args: 'allow image on' }), command.handler({ ...base, args: 'allow video on' })]);
  assert.deepEqual(await createPolicyStore(root).read(), { image: true, video: true });
  await command.handler({ ...base, args: 'allow image off' });
  assert.deepEqual(await store.read(), { image: false, video: true });
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
