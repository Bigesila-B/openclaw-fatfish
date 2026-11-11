import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskManager } from '../src/tasks.js';

const ctx = { channel: 'snowluma', senderId: '123456', from: 'group:222222', accountId: 'default' };
async function fixture(t, overrides = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fatfish-jobs-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  let posts = 0, sends = 0;
  const options = {
    stateDir, optionsFor: () => ({ enabled: true, provider: 'agnes' }), authorize: async () => true,
    delivery: { check: async () => {}, deliver: async (_ctx, _kind, _sources, hooks) => { sends++; await hooks?.onCreated('delivery-1'); return { details: { status: 'sent', deliveryId: 'delivery-1' } }; }, resend: async () => { sends++; return { text: '已发送', details: { status: 'sent', deliveryId: 'delivery-1' } }; } },
    generate: async () => { posts++; return { filePath: 'https://media.example.com/result.mp4' }; },
    resume: async () => { throw new Error('unexpected resume'); }, ...overrides
  };
  return { options, manager: createTaskManager(options), stateDir, counters: () => ({ posts, sends }) };
}

test('队列去重与异步发送，查看任务不暴露提示词或文件路径', async t => {
  const f = await fixture(t);
  const a = await f.manager.submit(ctx, 'video', '私人提示词', 'same-call');
  const b = await f.manager.submit(ctx, 'video', '私人提示词', 'same-call');
  assert.equal(a.details.taskId, b.details.taskId);
  await f.manager.start();
  await f.manager.waitForIdle();
  assert.deepEqual(f.counters(), { posts: 1, sends: 1 });
  const reply = await f.manager.command(ctx, a.details.taskId);
  assert.match(reply.text, /已完成/);
  assert.doesNotMatch(reply.text, /私人提示词|media\.example/);
  await assert.rejects(f.manager.command({ ...ctx, senderId: '654321' }, a.details.taskId), /原会话/);
  await assert.rejects(f.manager.command({ ...ctx, accountId: 'other' }, a.details.taskId), /原会话/);
  await f.manager.stop();
});

test('同时重发同一任务只发送一次，完成后不重复发送', async t => {
  let sends = 0;
  const f = await fixture(t, { delivery: {
    check: async () => {},
    deliver: async () => ({ details: { status: 'unknown', deliveryId: 'delivery-1' } }),
    resend: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 15)); return { text: '已发送', details: { status: 'sent', deliveryId: 'delivery-1' } }; }
  } });
  await f.manager.start();
  const job = await f.manager.submit(ctx, 'video', 'fish');
  await f.manager.waitForIdle();
  await Promise.all([f.manager.command(ctx, `send ${job.details.taskId}`), f.manager.command(ctx, `send ${job.details.taskId}`)]);
  await f.manager.command(ctx, `send ${job.details.taskId}`);
  assert.equal(sends, 1);
  await assert.rejects(f.manager.command(ctx, 'send'), /用法/);
  await f.manager.stop();
});

test('重启后只恢复服务端已有任务的查询，不重复提交 POST', async t => {
  let posts = 0, resumes = 0, submitted;
  const checkpoint = new Promise(resolve => { submitted = resolve; });
  const f = await fixture(t, { generate: async (_kind, _prompt, _options, controls) => {
    posts++;
    await controls.onSubmitted({ taskId: 'provider-1', model: 'agnes-video-2.5-flash' });
    submitted();
    await new Promise((_resolve, reject) => controls.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  }, resume: async (_kind, id) => { resumes++; assert.equal(id, 'provider-1'); return { filePath: 'https://media.example.com/existing.mp4' }; } });
  await f.manager.start();
  const job = await f.manager.submit(ctx, 'video', 'fish');
  await checkpoint;
  await f.manager.stop();
  const restarted = createTaskManager(f.options);
  await restarted.start(); await restarted.waitForIdle();
  assert.equal(posts, 1); assert.equal(resumes, 1);
  assert.match((await restarted.command(ctx, job.details.taskId)).text, /已完成/);
  await restarted.stop();
});

test('提交结果未知时保留记录，重启和恢复命令都不会再次创建任务', async t => {
  let posts = 0;
  const f = await fixture(t, { generate: async () => { posts++; throw new Error('connection interrupted'); } });
  await f.manager.start();
  const job = await f.manager.submit(ctx, 'video', 'fish');
  await f.manager.waitForIdle(); await f.manager.stop();
  const restarted = createTaskManager(f.options);
  await restarted.start(); await restarted.waitForIdle();
  assert.match((await restarted.command(ctx, job.details.taskId)).text, /提交结果不确定/);
  assert.match((await restarted.command(ctx, `resume ${job.details.taskId}`)).text, /不会重新提交/);
  assert.equal(posts, 1);
  await restarted.stop();
});

test('排队期间撤销权限不会调用供应商，取消期间收到服务端编号也不会恢复发送', async t => {
  let allowed = true, posts = 0;
  const f = await fixture(t, { authorize: async () => allowed, generate: async () => { posts++; return { filePath: 'https://example.com/x' }; } });
  const queued = await f.manager.submit(ctx, 'image', 'fish');
  allowed = false;
  await f.manager.start(); await f.manager.waitForIdle();
  assert.equal(posts, 0);
  assert.doesNotMatch((await f.manager.command(ctx, queued.details.taskId)).text, /已完成/);
  await f.manager.stop();
  let checkpoint;
  const wait = new Promise(resolve => { checkpoint = resolve; });
  const other = await fixture(t, { generate: async (_k, _p, _o, controls) => {
    await wait;
    await controls.onSubmitted({ taskId: 'late-id', model: 'video' });
    return { filePath: 'https://media.example.com/x.mp4' };
  } });
  await other.manager.start();
  const job = await other.manager.submit(ctx, 'video', 'fish');
  await new Promise(resolve => setTimeout(resolve, 15));
  await other.manager.command(ctx, `cancel ${job.details.taskId}`);
  checkpoint(); await other.manager.waitForIdle();
  const state = JSON.parse(await readFile(join(other.stateDir, 'fatfish', 'tasks.json'), 'utf8'));
  assert.equal(state.jobs[0].state, 'cancelled');
  assert.equal(other.counters().sends, 0);
  await other.manager.stop();
});
