import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBlacklistStore, makeBlacklistHook, shouldBlock } from '../src/blacklist.js';
import { createPolicyStore, makeAdminCommand } from '../src/permissions.js';

test('blocks users and groups independently and fails closed on missing identity', () => {
  const policy = { users: ['111111'], groups: ['222222'] };
  const ctx = { channel: 'snowluma', senderId: '333333', conversationId: 'group:444444' };
  assert.equal(shouldBlock(policy, ctx), false);
  assert.equal(shouldBlock(policy, { ...ctx, senderId: '111111' }), true);
  assert.equal(shouldBlock(policy, { ...ctx, conversationId: 'snowluma:group:222222' }), true);
  assert.equal(shouldBlock(policy, { ...ctx, conversationId: 'private:222222' }), false);
  assert.equal(shouldBlock(policy, { ...ctx, senderId: undefined }), true);
  assert.equal(shouldBlock(policy, { ...ctx, conversationId: undefined }), true);
  assert.equal(shouldBlock(policy, { ...ctx, channel: 'other', senderId: '111111' }), false);
});

test('hook suppresses matching messages and policy errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-blacklist-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createBlacklistStore(root, { users: ['111111'] });
  const hook = makeBlacklistHook(store);
  const ctx = { channelId: 'snowluma', senderId: '111111', conversationId: 'private:111111' };
  assert.deepEqual(await hook({}, ctx), { handled: true });
  assert.equal(await hook({}, { ...ctx, channelId: 'telegram' }), undefined);
  await mkdir(join(root, 'fatfish'));
  await writeFile(join(root, 'fatfish', 'blacklist.json'), '{');
  assert.deepEqual(await hook({}, ctx), { handled: true });
});

test('administrator changes persist and blocked users cannot invoke commands', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-blacklist-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blacklistStore = createBlacklistStore(root);
  const cmd = makeAdminCommand({ admins: ['123456'], store: createPolicyStore(root), blacklistStore });
  const admin = { channel: 'snowluma', senderId: '123456', isAuthorizedSender: true, from: 'snowluma:private:123456' };
  assert.match((await cmd.handler({ ...admin, senderId: '999999', args: 'blacklist add group 222222' })).text, /仅限/);
  await Promise.all([
    cmd.handler({ ...admin, args: 'blacklist add user 111111' }),
    cmd.handler({ ...admin, args: 'blacklist add group 222222' })
  ]);
  assert.deepEqual(await createBlacklistStore(root).read(), { users: ['111111'], groups: ['222222'] });
  assert.match((await cmd.handler({ ...admin, args: 'blacklist list' })).text, /111111/);
  const groupList = await cmd.handler({ ...admin, from: 'snowluma:group:444444', args: 'blacklist list' });
  assert.doesNotMatch(groupList.text, /111111|222222/);
  assert.deepEqual(await cmd.handler({ ...admin, senderId: '111111', args: 'permissions' }), {});
  assert.deepEqual(await cmd.handler({ ...admin, from: 'snowluma:group:222222', args: 'permissions' }), {});
  assert.deepEqual(await cmd.handler({ ...admin, senderId: '111111', args: 'help' }), {});
  assert.deepEqual(await cmd.handler({ ...admin, from: 'snowluma:group:222222', args: 'help' }), {});
  await cmd.handler({ ...admin, args: 'blacklist remove user 111111' });
  assert.deepEqual(await blacklistStore.read(), { users: [], groups: ['222222'] });
});
