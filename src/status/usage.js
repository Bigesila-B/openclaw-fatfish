import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { jsonStore } from '../state-store.js';
import { channelOf, scopeOf } from '../context.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) : null;
const dateFormatters = new Map();
export function dateKey(time, timeZone) {
  if (!dateFormatters.has(timeZone)) {
    if (dateFormatters.size > 16) dateFormatters.clear();
    dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  }
  const parts = dateFormatters.get(timeZone).formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
const accountKey = ctx => hash(JSON.stringify([channelOf(ctx), scopeOf(ctx).accountId]));
const sessionKey = ctx => ctx.sessionKey ? hash(`${accountKey(ctx)}:${ctx.sessionKey}`) : null;
const pruneSessions = value => { value.sessions = Object.fromEntries(Object.entries(value.sessions).sort((a, b) => b[1].at - a[1].at).slice(0, 500)); };

export function createUsageStore(stateDir, { now = Date.now } = {}) {
  const pending = new Map();
  const explicitAccount = ctx => ctx.accountId ?? ctx.agentAccountId ?? ctx.deliveryContext?.accountId;
  const correlation = (session, run) => hash(JSON.stringify([session, run]));
  const store = jsonStore(join(stateDir, 'fatfish', 'usage.json'), { version: 1, since: now(), events: [], sessions: {}, truncated: false }, value => {
    if (value?.version !== 1 || !Array.isArray(value.events) || !value.sessions || typeof value.sessions !== 'object') throw new Error('用量记录格式无效。');
    return value;
  });
  async function observe(event, ctx) {
    const timestamp = now(), session = sessionKey(ctx);
    if (!ctx.sessionKey || !event.runId) return;
    // 部分宿主的 LLM 钩子不带账号，不能把不同机器人混记为 default。
    // 只暂存数字，等有精确 runId 的回复钩子携带账号后归属。
    if (!explicitAccount(ctx)) {
      for (const [key, item] of pending) if (item.expires < timestamp) pending.delete(key);
      pending.set(correlation(ctx.sessionKey, event.runId), { channel: channelOf(ctx), expires: timestamp + 600000, event: { runId: event.runId, provider: clean(event.provider), model: clean(event.model), usage: event.usage ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'total'].map(key => [key, number(event.usage[key])])) : undefined } });
      while (pending.size > 500) pending.delete(pending.keys().next().value);
      return;
    }
    const id = hash(JSON.stringify([accountKey(ctx), ctx.sessionKey, event.runId, event.provider, event.model]));
    await store.update(value => {
      if (session) value.sessions[session] = { ...(value.sessions[session] ?? {}), provider: clean(event.provider), model: clean(event.model), at: timestamp };
      pruneSessions(value);
      if (!event.usage || value.events.some(item => item.id === id)) return;
      const usage = event.usage;
      value.events.push({ id, at: timestamp, account: accountKey(ctx), input: number(usage.input), output: number(usage.output), cacheRead: number(usage.cacheRead), cacheWrite: number(usage.cacheWrite), total: number(usage.total) });
      value.events = value.events.filter(item => item.at >= timestamp - 45 * 86400000);
      if (value.events.length > 20000) { value.events = value.events.slice(-20000); value.truncated = true; }
    });
  }
  async function observeReply(event, ctx) {
    const source = { ...ctx, sessionKey: event.sessionKey ?? ctx.sessionKey };
    if (!explicitAccount(source)) return;
    const key = correlation(source.sessionKey, event.runId ?? ctx.runId), item = pending.get(key);
    if (item && item.expires >= now() && item.channel === channelOf(source)) {
      pending.delete(key);
      await observe(item.event, source);
    }
    const usage = event.usageState, session = sessionKey(source);
    if (!session || !usage) return;
    await store.update(value => {
      const previous = value.sessions[session] ?? {};
      value.sessions[session] = { ...previous, used: number(usage.contextUsedTokens), limit: number(usage.contextTokenBudget), provider: clean(usage.provider) ?? previous.provider, model: clean(usage.model) ?? previous.model, at: now() };
      pruneSessions(value);
    });
  }
  async function report(ctx, timeZone = 'Asia/Macau') {
    const state = await store.read(), today = dateKey(now(), timeZone), month = today.slice(0, 7), account = accountKey(ctx);
    const sum = events => {
      if (!events.length) return null;
      const result = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: events.length, complete: true };
      for (const event of events) {
        for (const name of ['input', 'output', 'cacheRead', 'cacheWrite']) result[name] = result[name] === null || event[name] === null ? null : result[name] + event[name];
        if (event.total !== null) { if (result.total !== null) result.total += event.total; }
        else if (['input', 'output', 'cacheRead', 'cacheWrite'].every(key => event[key] !== null)) { if (result.total !== null) result.total += event.input + event.output + event.cacheRead + event.cacheWrite; }
        else { result.complete = false; result.total = null; }
      }
      return result;
    };
    const events = state.events.filter(event => event.account === account);
    return { today: sum(events.filter(event => dateKey(event.at, timeZone) === today)), month: sum(events.filter(event => dateKey(event.at, timeZone).startsWith(month))), observedSince: state.since, truncated: state.truncated, scope: '当前 QQ 通道与机器人账号，插件启用后观测的调用；不含未上报或未开放钩子的用量', current: state.sessions[sessionKey(ctx)] ?? null, timeZone };
  }
  return { observe, observeReply, report };
}
