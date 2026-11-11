import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMediaDelivery } from '../src/media-delivery.js';

const ctx = { messageChannel: 'snowluma', requesterSenderId: '123456', deliveryContext: { channel: 'snowluma', to: 'group:222222', accountId: 'bot-a' } };

async function setup(t, sendMedia) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fatfish-delivery-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const file = join(stateDir, 'image.png');
  await writeFile(file, 'image');
  let allowed = true;
  const api = { config: { channels: {} }, runtime: { channel: { outbound: { loadAdapter: async () => ({ sendMedia }) } } } };
  const service = createMediaDelivery(api, { stateDir, authorize: async () => allowed });
  return { service, file, stateDir, revoke: () => { allowed = false; }, api };
}

test('媒体发送只使用宿主的当前会话，确认回执后才报告成功', async t => {
  let sent;
  const { service, file } = await setup(t, async options => { sent = options; return { channel: 'snowluma', messageId: 'msg-1' }; });
  const result = await service.deliver(ctx, 'image', [file]);
  assert.equal(result.details.status, 'sent');
  assert.deepEqual(result.details.messageIds, ['msg-1']);
  assert.equal(sent.to, 'group:222222');
  assert.equal(sent.accountId, 'bot-a');
  assert.equal(sent.mediaUrl, file);
  assert.doesNotMatch(result.text, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(JSON.stringify(result).includes(file), false);
});

test('发送失败不自动重试，重启后可重发已有文件且已发成功的文件不会重复发送', async t => {
  let calls = 0;
  const fixture = await setup(t, async () => {
    if (++calls === 2) throw new Error('transport secret /srv/private');
    return { channel: 'snowluma', messageId: `msg-${calls}` };
  });
  const second = join(fixture.stateDir, 'second.png');
  await writeFile(second, 'second');
  const first = await fixture.service.deliver(ctx, 'parse', [fixture.file, second]);
  assert.equal(calls, 2);
  assert.equal(first.details.status, 'unknown');
  assert.equal(first.details.sent, 1);
  assert.match(first.text, /先检查 QQ/);
  assert.doesNotMatch(first.text, /transport|secret|private/);
  const restarted = createMediaDelivery(fixture.api, { stateDir: fixture.stateDir, authorize: async () => true });
  const retry = await restarted.resend(ctx, first.details.deliveryId);
  assert.equal(retry.details.status, 'sent');
  assert.equal(calls, 3);
  await restarted.resend(ctx, first.details.deliveryId);
  assert.equal(calls, 3, '全部成功后再次执行不重复发送');
});

test('缺少回执不能当作已发送，语音失败可以显式按附件重发', async t => {
  const requests = [];
  const { service, file } = await setup(t, async options => { requests.push(options); return requests.length === 1 ? {} : { messageId: 'file-1' }; });
  const result = await service.deliver(ctx, 'tts', [file]);
  assert.equal(result.details.status, 'unknown');
  assert.equal(requests[0].audioAsVoice, true);
  const retry = await service.resend(ctx, result.details.deliveryId, { forceDocument: true });
  assert.equal(retry.details.status, 'sent');
  assert.equal(requests[1].forceDocument, true);
  assert.notEqual(requests[1].audioAsVoice, true);
});

test('媒体重发绑定用户、群、机器人账号和线程，权限撤销后拒绝', async t => {
  let calls = 0;
  const { service, file, revoke } = await setup(t, async () => { calls++; return { messageId: 'msg-1' }; });
  const result = await service.deliver(ctx, 'image', [file]);
  const id = result.details.deliveryId;
  for (const forged of [
    { ...ctx, requesterSenderId: '234567' },
    { ...ctx, deliveryContext: { ...ctx.deliveryContext, to: 'group:333333' } },
    { ...ctx, deliveryContext: { ...ctx.deliveryContext, accountId: 'bot-b' } },
    { ...ctx, deliveryContext: { ...ctx.deliveryContext, threadId: 'other' } }
  ]) await assert.rejects(service.resend(forged, id), /只能在原会话/);
  revoke();
  await assert.rejects(service.resend(ctx, id), /没有发送/);
  assert.equal(calls, 1);
});

test('缺少可信路由、通道冲突和缺少发送能力时在生成前拒绝', async t => {
  const { service, api } = await setup(t, undefined);
  await assert.rejects(service.check({ messageChannel: 'snowluma', requesterSenderId: '123456', sessionKey: 'not-a-target' }, 'image'), /无法确定/);
  await assert.rejects(service.check({ ...ctx, messageChannel: 'qqbot' }, 'image'), /不一致/);
  await assert.rejects(service.check(ctx, 'image'), /发送能力/);
  api.runtime.channel.outbound.loadAdapter = async () => ({ sendMedia: async () => ({ messageId: '1' }) });
  delete api.config;
  await assert.rejects(service.check(ctx, 'image'), /发送配置/);
});

test('同时重发同一编号不会重复调用平台', async t => {
  let calls = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const fixture = await setup(t, async () => {
    calls++;
    if (calls === 1) return {};
    await barrier;
    return { messageId: 'sent' };
  });
  const result = await fixture.service.deliver(ctx, 'image', [fixture.file]);
  const first = fixture.service.resend(ctx, result.details.deliveryId);
  const second = fixture.service.resend(ctx, result.details.deliveryId);
  // 让两个请求都进入锁，再释放模拟平台回执。
  setTimeout(release, 25);
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(calls, 2);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
});

test('命令的原始 To 是机器人时仍回复 From，兼容通道前缀与线程字段', async t => {
  let target;
  const fixture = await setup(t, async options => { target = options; return { messageId: '1' }; });
  const command = { channel: 'snowluma', senderId: '123456', from: 'snowluma:group:222222', to: 'private:999999', messageThreadId: 42 };
  const delivered = await fixture.service.deliver(command, 'image', [fixture.file]);
  assert.equal(target.to, 'snowluma:group:222222');
  assert.equal(target.threadId, '42');
  const tool = { ...ctx, deliveryContext: { channel: 'snowluma', to: 'group:222222', threadId: '42' } };
  assert.equal((await fixture.service.resend(tool, delivered.details.deliveryId)).details.status, 'sent');
});
