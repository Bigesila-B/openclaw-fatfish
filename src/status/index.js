import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonStore } from '../state-store.js';
import { conversationKey, scopeOf } from '../context.js';
import { CAPABILITIES } from '../capabilities.js';
import { cleanupCache } from '../media-cache.js';
import { collectHost } from './metrics.js';
import { renderStatus, statusText } from './render.js';

const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const safeModel = value => typeof value === 'string' && !/https?:|[\x00-\x1f]/i.test(value) ? value.slice(0, 160) : null;
async function bounded(operation, ms = 1500) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('采集超时')), ms); timer.unref?.(); })]); }
  finally { clearTimeout(timer); }
}
export const DEFAULT_PANEL = { enabled: true, format: 'image', theme: 'dark', publicSummary: false, timeZone: 'Asia/Macau', cooldownSeconds: 10, gpu: true };

export function createStatusService(api, { stateDir, config = {}, usage, isAdmin, send, parseState, tasks, hostCollector = collectHost, renderer = renderStatus }) {
  const settingsStore = jsonStore(join(stateDir, 'fatfish', 'panel.json'), { version: 1, overrides: {} }, value => {
    if (value?.version !== 1 || !value.overrides || typeof value.overrides !== 'object') throw new Error('面板设置损坏。');
    return value;
  });
  const health = jsonStore(join(stateDir, 'fatfish', 'health.json'), { version: 1, items: {} });
  const collectors = new Map(), cooldowns = new Map();
  let hostCache;
  async function settings() {
    const value = { ...DEFAULT_PANEL, ...config, ...(await settingsStore.read()).overrides };
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: value.timeZone }); } catch { value.timeZone = DEFAULT_PANEL.timeZone; }
    return value;
  }
  async function authorize(ctx, capability) {
    const options = await settings(), scope = scopeOf(ctx);
    if (!options.enabled) return false;
    return capability === 'status-private' ? scope.kind === 'private' && isAdmin(ctx) : capability === 'status-public' && options.publicSummary === true;
  }
  async function featureStates() {
    const recent = (await health.read().catch(() => ({ items: {} }))).items ?? {};
    const features = CAPABILITIES;
    return Promise.all(features.map(async feature => {
      const options = api.pluginConfig?.[feature.configKey] ?? {};
      const enabled = feature.id === 'parse' && parseState ? await parseState.read() : options.enabled === true;
      const key = ['image', 'video'].includes(feature.id) && options.provider === 'agnes' ? 'AGNES_API_KEY' : feature.id === 'tts' && options.provider === 'mimo' ? 'MIMO_API_KEY' : feature.id === 'stt' ? 'SILICONFLOW_API_KEY' : null;
      let status = !enabled ? '已关闭' : key && !process.env[key] ? '未配置凭据' : '已启用，尚未测试';
      if (enabled && recent[feature.id]) status = recent[feature.id].ok ? '最近调用成功' : '最近调用失败';
      return { id: feature.id, label: feature.label, status, lastTest: recent[feature.id]?.at ?? null };
    }));
  }
  async function snapshot(ctx, { publicOnly = false } = {}) {
    const options = await settings(), features = await featureStates();
    if (publicOnly) return { public: true, features: features.map(({ id, label, status }) => ({ id, label, status: status === '已关闭' ? '已关闭' : '已启用' })) };
    const observed = await usage.report(ctx, options.timeZone).catch(() => ({ today: null, month: null, current: null, timeZone: options.timeZone, scope: '用量记录不可读取，统计不完整' }));
    const current = observed.current;
    let entry;
    try {
      if (ctx.sessionKey) entry = await bounded(() => api.runtime.agent?.session?.getSessionEntry?.({ sessionKey: ctx.sessionKey }));
    } catch { /* 旧宿主或权限限制：使用被动观测快照。 */ }
    const model = safeModel(entry?.model) ?? safeModel(current?.model);
    const provider = safeModel(entry?.modelProvider) ?? safeModel(current?.provider);
    let used = entry?.totalTokensFresh === true ? number(entry.totalTokens) : null;
    let limit = number(entry?.contextTokens);
    if (used === null && current?.used != null) used = current.used;
    if (limit === null && current?.limit != null) limit = current.limit;
    const now = Date.now();
    if (!hostCache || hostCache.at < now - 5000) hostCache = { at: now, promise: bounded(() => hostCollector({ diskPath: options.diskPath || stateDir, gpu: options.gpu !== false }), 4000).catch(() => ({ cpuPercent: null, memory: null, disk: null, gpus: null, scope: '采集不可用' })) };
    const host = await hostCache.promise;
    let version = '未知';
    try { version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch {}
    const extra = await Promise.all([...collectors].map(async ([id, collect]) => {
      try { const value = await bounded(() => collect({ ctx, options })); return { id, value: String(value).replace(/[\x00-\x1f]/g, '').slice(0, 200) }; }
      catch { return { id, value: '不可用' }; }
    }));
    return { public: false, version, model: model ? `${provider ? `${provider}/` : ''}${model}` : null, modelSource: entry?.model ? 'OpenClaw 当前会话' : current?.model ? '最近一次已观测调用' : null, context: { used, limit }, usage: observed, host, tasks: tasks ? await bounded(() => tasks.counts(ctx)).catch(() => null) : null, features, extra, generatedAt: new Intl.DateTimeFormat('zh-CN', { timeZone: options.timeZone, dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(now) };
  }
  async function handle(ctx, mode) {
    const options = await settings(), full = await authorize(ctx, 'status-private');
    if (!full && !await authorize(ctx, 'status-public')) return { text: options.enabled ? '完整状态面板仅限管理员私聊查询；群内简报尚未开放。' : '状态面板已关闭。' };
    const key = `${conversationKey(ctx)}:${scopeOf(ctx).senderId}`, now = Date.now();
    if ((cooldowns.get(key) ?? 0) > now) return { text: '状态查询过于频繁，请稍后再试。' };
    cooldowns.set(key, now + options.cooldownSeconds * 1000);
    if (cooldowns.size > 1000) for (const [id, expires] of cooldowns) if (expires < now) cooldowns.delete(id);
    while (cooldowns.size > 1000) cooldowns.delete(cooldowns.keys().next().value);
    const data = await snapshot(ctx, { publicOnly: !full }), text = statusText(data);
    if ((mode ?? options.format) === 'text') return { text };
    try {
      const dir = join(stateDir, 'fatfish', 'cache', 'panels');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await cleanupCache(dir, { maxBytes: 16 * 1024 ** 2, maxAgeDays: 1 / 24 });
      const buffer = await renderer(data, options);
      if (!buffer?.length || buffer.length > 5 * 1024 ** 2) throw new Error('面板图片过大。');
      const path = join(dir, `${randomUUID()}.png`);
      await writeFile(path, buffer, { mode: 0o600, flag: 'wx' });
      const delivered = await send(ctx, full ? 'status-private' : 'status-public', [path]);
      if (delivered.details.status === 'sent') return { text: '状态面板已发送。' };
    } catch { /* 以同一份已经过滤的数据生成文字降级。 */ }
    return { text: `图片未能确认送达，以下为文字状态：\n${text}` };
  }
  async function configure(ctx, args) {
    if (!isAdmin(ctx) || scopeOf(ctx).kind !== 'private') return { text: '面板设置仅限管理员私聊修改。' };
    const parts = args.trim().split(/\s+/);
    if (parts[0] === 'settings' || !parts[0]) {
      const value = await settings();
      return { text: `面板：${value.enabled ? '开启' : '关闭'}；格式 ${value.format}；主题 ${value.theme}；群内简报 ${value.publicSummary ? '开放' : '关闭'}；时区 ${value.timeZone}。\n用法：/fish panel on|off；/fish panel image|text；/fish panel theme dark|light；/fish panel public on|off` };
    }
    let patch;
    if (parts.length === 1 && ['on', 'off'].includes(parts[0])) patch = { enabled: parts[0] === 'on' };
    if (parts.length === 1 && ['image', 'text'].includes(parts[0])) patch = { format: parts[0] };
    if (parts.length === 2 && parts[0] === 'theme' && ['dark', 'light'].includes(parts[1])) patch = { theme: parts[1] };
    if (parts.length === 2 && parts[0] === 'public' && ['on', 'off'].includes(parts[1])) patch = { publicSummary: parts[1] === 'on' };
    if (!patch) return { text: '面板设置参数无效；用 /fish panel settings 查看用法。' };
    await settingsStore.update(value => Object.assign(value.overrides, patch));
    return { text: '面板设置已保存，下次查询生效。完整状态始终仅管理员私聊可见。' };
  }
  return { handle, configure, snapshot, settings, authorize, registerCollector(id, collect) { if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id) || typeof collect !== 'function' || collectors.has(id) || collectors.size >= 8) throw new Error('无效、重复或超过上限的面板采集器。'); collectors.set(id, collect); }, async recordHealth(id, ok) { await health.update(value => { value.items[id] = { ok: ok === true, at: new Date().toISOString() }; }); } };
}
