import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonaStore, makePersonaHook } from '../src/persona.js';
import { createPolicyStore, makeAdminCommand } from '../src/permissions.js';

test('persona applies only to the SnowLuma channel and tracks saved changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-persona-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createPersonaStore(root, { enabled: true, prompt: '温柔地说话' });
  const hook = makePersonaHook(store);
  assert.equal(await hook({}, { channel: 'other' }), undefined);
  assert.match((await hook({}, { messageProvider: 'snowluma' })).appendSystemContext, /温柔地说话/);
  await store.change({ type: 'set', prompt: '喜欢吃鱼，说话简短' });
  assert.match((await hook({}, { channel: 'snowluma' })).appendSystemContext, /喜欢吃鱼/);
  await store.change({ type: 'enabled', enabled: false });
  assert.equal(await hook({}, { channel: 'snowluma' }), undefined);
  await store.change({ type: 'reset' });
  assert.match((await hook({}, { channel: 'snowluma' })).appendSystemContext, /温柔地说话/);
});

test('only a QQ administrator can change persona and empty descriptions are rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-persona-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const personaStore = createPersonaStore(root);
  const command = makeAdminCommand({ admins: ['123456'], store: createPolicyStore(root), personaStore });
  const admin = { channel: 'snowluma', senderId: '123456', isAuthorizedSender: true };
  assert.match((await command.handler({ ...admin, senderId: '111111', args: 'persona set 伪装' })).text, /仅限/);
  assert.deepEqual(await personaStore.read(), { enabled: false, prompt: '' });
  assert.match((await command.handler({ ...admin, args: 'persona on' })).text, /不能为空/);
  await command.handler({ ...admin, args: 'persona set 你是大肥鱼，友善活泼。' });
  assert.deepEqual(await personaStore.read(), { enabled: true, prompt: '你是大肥鱼，友善活泼。' });
  assert.match((await command.handler({ ...admin, args: `persona set ${'鱼'.repeat(1501)}` })).text, /1500/);
  assert.equal((await personaStore.read()).prompt, '你是大肥鱼，友善活泼。');
});
