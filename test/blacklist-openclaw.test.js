import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shouldBlock } from '../src/blacklist.js';

test('OpenClaw maps a SnowLuma group into the expected blacklist identity', { skip: !process.env.FATFISH_OPENCLAW_DIST }, async () => {
  const directory = process.env.FATFISH_OPENCLAW_DIST;
  const file = (await readdir(directory)).find(name => /^message-hook-mappers-.*\.js$/.test(name));
  assert.ok(file, 'OpenClaw message mapper not found');
  const mapper = await import(pathToFileURL(join(directory, file)).href);
  const canonical = mapper.n({ OriginatingChannel: 'snowluma', Provider: 'snowluma', From: 'snowluma:group:222222', To: 'snowluma:group:222222', OriginatingTo: 'snowluma:group:222222', ChatType: 'group', SenderId: '111111' });
  const context = mapper.s(canonical);
  assert.equal(context.channelId, 'snowluma');
  assert.equal(context.conversationId, 'group:222222');
  assert.equal(context.senderId, '111111');
  assert.equal(shouldBlock({ users: [], groups: ['222222'] }, { channel: context.channelId, senderId: context.senderId, conversationId: context.conversationId }), true);
});
