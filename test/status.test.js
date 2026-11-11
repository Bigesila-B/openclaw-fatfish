import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageStore } from '../src/status/usage.js';
import { createStatusService } from '../src/status/index.js';
import { renderStatus, statusText, statusSvg } from '../src/status/render.js';

const admin = { channel: 'snowluma', senderId: '123456', from: 'private:123456', accountId: 'a', sessionKey: 'agent:main:snowluma:direct:123456' };
const group = { ...admin, from: 'group:222222' };
const host = { cpuPercent: 25, memory: { used: 4 * 1024 ** 3, total: 8 * 1024 ** 3 }, disk: null, gpus: null, scope: '当前进程所见系统' };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('用量按时区自然日/月汇总，重复事件与机器人账号隔离，重启保留', async t => {
  const dir = await setup(t);
  let now = Date.parse('2026-11-30T15:59:59Z');
  const usage = createUsageStore(dir, { now: () => now });
  const event = { runId: 'run-1', model: 'real-model', provider: 'provider', usage: { input: 100, output: 20, total: 120 } };
  assert.equal((await usage.report(admin)).today, null);
  await usage.observe(event, admin);
  await usage.observe(event, admin);
  now = Date.parse('2026-11-30T16:00:01Z');
  await usage.observe({ ...event, runId: 'run-2', usage: { total: 50 } }, admin);
  const report = await usage.report(admin);
  assert.equal(report.month.total, 50);
  assert.equal(report.today.input, null, '未知输入量不能填成零');
  assert.equal((await usage.report(admin, 'UTC')).month.total, 170);
  assert.equal((await usage.report({ ...admin, accountId: 'b' })).month, null);
  const restarted = createUsageStore(dir, { now: () => now });
  assert.equal((await restarted.report(admin)).month.total, 50);
  assert.equal((await restarted.report(admin)).current.model, 'real-model');
});

test('无完整计数的调用不填零，同名 session/run 在不同账号不冲突', async t => {
  const usage = createUsageStore(await setup(t));
  const event = { runId: 'r', model: 'model', usage: {} };
  await usage.observe(event, admin);
  assert.equal((await usage.report(admin)).today.total, null);
  await usage.observe({ ...event, usage: { total: 15 } }, { ...admin, accountId: 'b' });
  assert.equal((await usage.report({ ...admin, accountId: 'b' })).today.total, 15);
});

test('旧 LLM 钩子缺少账号时等待精确回复关联，不把多账号混计为 default', async t => {
  const usage = createUsageStore(await setup(t));
  const old = { ...admin, accountId: undefined };
  await usage.observe({ runId: 'r', model: 'm', usage: { total: 23 } }, old);
  assert.equal((await usage.report({ ...old, accountId: 'default' })).today, null);
  await usage.observeReply({ sessionKey: admin.sessionKey, runId: 'different', usageState: {} }, admin);
  assert.equal((await usage.report(admin)).today, null);
  await usage.observeReply({ sessionKey: admin.sessionKey, runId: 'r', usageState: { contextUsedTokens: 12 } }, admin);
  assert.equal((await usage.report(admin)).today.total, 23);
  assert.equal((await usage.report(admin)).current.used, 12);
});

test('群内与普通用户默认不显示完整状态，开放简报也不会采集或泄露主机和用量', async t => {
  const dir = await setup(t);
  let samples = 0;
  const service = createStatusService({ pluginConfig: { tts: { enabled: true } }, runtime: {} }, { stateDir: dir, usage: createUsageStore(dir), isAdmin: ctx => ctx.senderId === admin.senderId, hostCollector: async () => { samples++; return host; } });
  assert.match((await service.handle(group, 'text')).text, /仅限管理员私聊/);
  assert.equal(samples, 0);
  await service.configure(admin, 'public on');
  const reply = await service.handle({ ...group, senderId: '654321' }, 'text');
  assert.match(reply.text, /状态简报/);
  assert.doesNotMatch(reply.text, /GB|CPU|模型：|今日：/);
  assert.equal(samples, 0);
  assert.match((await service.configure(group, 'public off')).text, /仅限管理员私聊/);
});

test('当前上下文只使用新鲜会话快照，不把累计调用 token 当成上下文', async t => {
  const dir = await setup(t), usage = createUsageStore(dir);
  await usage.observe({ runId: 'r', provider: 'provider', model: 'model', usage: { input: 90000, output: 1000, total: 91000 } }, admin);
  const api = { pluginConfig: {}, runtime: { agent: { session: { getSessionEntry: () => ({ model: 'actual', modelProvider: 'real', totalTokens: 999999, totalTokensFresh: false, contextTokens: 128000 }) } } } };
  const service = createStatusService(api, { stateDir: dir, usage, isAdmin: () => true, hostCollector: async () => host });
  const snapshot = await service.snapshot(admin);
  assert.equal(snapshot.context.used, null);
  assert.equal(snapshot.context.limit, 128000);
  assert.equal(snapshot.model, 'real/actual');
  await usage.observeReply({ sessionKey: admin.sessionKey, usageState: { contextUsedTokens: 12000, contextTokenBudget: 128000 } }, admin);
  assert.equal((await service.snapshot(admin)).context.used, 12000);
});

test('图片失败用同权限文字降级，面板设置重启保留，冷却不会调用生成模型', async t => {
  const dir = await setup(t), api = { pluginConfig: {}, runtime: {} };
  const options = { stateDir: dir, usage: createUsageStore(dir), isAdmin: () => true, hostCollector: async () => host, renderer: async () => { throw new Error('native unavailable'); } };
  const service = createStatusService(api, options);
  assert.match((await service.handle(admin)).text, /文字状态/);
  assert.match((await service.handle(admin)).text, /过于频繁/);
  await service.configure(admin, 'theme light');
  assert.equal((await createStatusService(api, options).settings()).theme, 'light');
});

test('状态卡片能真实生成 PNG，SVG 文本注入被转义，WASM 兼容渲染可用', async t => {
  const dir = await setup(t);
  const service = createStatusService({ pluginConfig: {}, runtime: {} }, { stateDir: dir, usage: createUsageStore(dir), isAdmin: () => true, hostCollector: async () => host });
  const data = await service.snapshot(admin);
  data.model = '<image href="https://secret.invalid/x"/>';
  const svg = statusSvg(data);
  assert.doesNotMatch(svg, /<image/);
  assert.match(svg, /&lt;image/);
  for (const engine of ['native', 'wasm']) {
    const buffer = await renderStatus(data, { engine });
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(buffer.readUInt32BE(16), 1000);
    assert.ok(buffer.length < 5 * 1024 ** 2);
  }
  assert.match(statusText(data), /上下文：不可用/);
});
