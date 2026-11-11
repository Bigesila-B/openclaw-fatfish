import { mkdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { leaseCachePaths } from './media-cache.js';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const first = (...values) => values.find(value => typeof value === 'string' && value);

// 目的地只取宿主提供的当前会话，绝不接收模型传入的 QQ 号或目标路径。
export function currentMediaRoute(ctx) {
  const delivery = ctx.deliveryContext ?? {};
  const channel = first(ctx.messageChannel, ctx.channel, ctx.nativeChannelId, delivery.channel);
  if (delivery.channel && channel !== delivery.channel) throw new Error('当前会话的通道信息不一致，未发送媒体。');
  // 命令上下文的原始 To 可能是机器人自身；回复目标应取 From/当前会话。
  const to = first(delivery.to, ctx.conversationId, ctx.from);
  const senderId = first(ctx.requesterSenderId, ctx.senderId, delivery.senderId);
  if (!channel || !to || !senderId) throw new Error('无法确定当前 QQ 会话的发送目标；请检查通道适配，尚未生成或发送媒体。');
  const threadId = delivery.threadId ?? ctx.messageThreadId ?? ctx.threadId;
  return { channel, to, senderId, accountId: delivery.accountId ?? ctx.accountId ?? ctx.agentAccountId ?? 'default', threadId: threadId == null ? null : String(threadId) };
}

function sameRoute(a, b) {
  const target = route => route.to?.startsWith(`${route.channel}:`) ? route.to.slice(route.channel.length + 1) : route.to;
  return target(a) === target(b) && ['channel', 'senderId', 'accountId', 'threadId'].every(key => (a[key] ?? null) === (b[key] ?? null));
}

export function createMediaDelivery(api, { stateDir, authorize }) {
  const directory = join(stateDir, 'fatfish', 'deliveries');
  const busy = new Set();
  const isAuthorized = async (ctx, capability) => {
    if (!await authorize(ctx, capability)) throw new Error('当前用户没有发送此媒体的权限，或来源已被加入黑名单。');
  };
  const save = async record => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${record.id}.json`), temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  };
  async function check(ctx, capability) {
    await isAuthorized(ctx, capability);
    const route = currentMediaRoute(ctx);
    const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config;
    if (!cfg) throw new Error('当前宿主未提供媒体发送配置，请升级或检查 OpenClaw。');
    const adapter = await api.runtime.channel?.outbound?.loadAdapter?.(route.channel);
    if (!adapter?.sendMedia && !adapter?.sendPayload) throw new Error('当前 QQ 通道尚未提供媒体发送能力，请检查通道插件。');
    const target = adapter.resolveTarget?.({ cfg, to: route.to, accountId: route.accountId });
    if (target && (target.ok !== true || typeof target.to !== 'string' || !target.to)) throw new Error('QQ 通道无法解析当前会话的媒体发送目标。');
    return { route, cfg, adapter, to: target?.to ?? route.to };
  }
  async function send(ctx, record, { forceDocument = false } = {}) {
    if (busy.has(record.id)) throw new Error('此媒体正在发送，请勿重复重发。');
    busy.add(record.id);
    const release = leaseCachePaths(record.items.filter(item => isAbsolute(item.source)).map(item => item.source));
    try {
      record = JSON.parse(await readFile(join(directory, `${record.id}.json`), 'utf8'));
      const { route, cfg, adapter, to } = await check(ctx, record.capability);
      if (!sameRoute(route, record.route)) throw new Error('只能在原会话中由原请求用户重发媒体。');
      for (const item of record.items) {
        if (item.status === 'sent') continue;
        await isAuthorized(ctx, record.capability);
        let source = item.source, mediaLocalRoots;
        if (isAbsolute(source)) {
          const info = await lstat(source);
          if (!info.isFile() || !info.size) throw new Error('媒体文件不存在或已清理，无法重发。');
          source = await realpath(source);
          mediaLocalRoots = [dirname(source)];
        } else {
          const url = new URL(source);
          if (url.protocol !== 'https:' || url.username || url.password) throw new Error('媒体地址无效，未发送。');
        }
        item.status = 'sending';
        await save(record);
        const payload = { mediaUrl: source, ...(record.capability === 'tts' && !forceDocument ? { audioAsVoice: true } : {}), ...(forceDocument ? { forceDocument: true } : {}) };
        let receipt;
        try {
          const options = { cfg, to, text: '', ...payload, accountId: route.accountId, threadId: route.threadId, mediaLocalRoots };
          receipt = adapter.sendMedia ? await adapter.sendMedia(options) : await adapter.sendPayload({ ...options, payload });
        } catch {
          // 网络失败不能证明平台没有收到，禁止静默重发，交给用户决定。
          item.status = 'unknown';
          await save(record);
          return result(record, '发送结果不确定；请先检查 QQ。确认未收到后，可重发已有结果。');
        }
        if (!receipt || typeof receipt.messageId !== 'string' || !receipt.messageId.trim() || (receipt.channel && receipt.channel !== route.channel)) {
          item.status = 'unknown';
          await save(record);
          return result(record, '通道未返回消息回执，无法确认是否发送成功；请先检查 QQ。');
        }
        item.status = 'sent';
        item.messageId = receipt.messageId;
        await save(record);
      }
      return result(record, '媒体已发送到当前 QQ 会话，已取得通道回执；无需再次发送。');
    } catch {
      return result(record, '媒体已准备好，但未能完成发送。请检查权限、文件是否过期及 QQ 通道状态，再重发已有结果。');
    } finally { release(); busy.delete(record.id); }
  }
  function result(record, text) {
    const sent = record.items.filter(item => item.status === 'sent').length;
    const status = sent === record.items.length ? 'sent' : record.items.some(item => ['unknown', 'sending'].includes(item.status)) ? 'unknown' : 'pending';
    return {
      text: `${text}${status === 'sent' ? '' : `\n重发：/fish resend ${record.id}；改为附件：/fish resend ${record.id} file。结果不确定时重发可能重复。`}`,
      details: { deliveryId: record.id, status, sent, total: record.items.length, messageIds: record.items.filter(item => item.status === 'sent').map(item => item.messageId) }
    };
  }
  return {
    check,
    async notice(ctx, capability, text) {
      const { route, cfg, adapter, to } = await check(ctx, capability);
      const options = { cfg, to, text, accountId: route.accountId, threadId: route.threadId };
      const receipt = adapter.sendText ? await adapter.sendText(options) : adapter.sendPayload ? await adapter.sendPayload({ ...options, payload: { text } }) : null;
      return Boolean(receipt?.messageId);
    },
    async deliver(ctx, capability, sources, { onCreated } = {}) {
      const { route } = await check(ctx, capability);
      if (!Array.isArray(sources) || !sources.length || sources.length > 16 || sources.some(source => typeof source !== 'string' || !source)) throw new Error('媒体结果清单无效。');
      const record = { id: randomUUID(), route, capability, createdAt: new Date().toISOString(), items: [...new Set(sources)].map(source => ({ source, status: 'pending' })) };
      await save(record);
      await onCreated?.(record.id);
      return send(ctx, record);
    },
    async inspect(ctx, id) {
      if (!idPattern.test(id)) throw new Error('媒体编号无效。');
      const record = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'));
      if (!sameRoute(currentMediaRoute(ctx), record.route)) throw new Error('只能查看原会话中的媒体。');
      return result(record, '').details;
    },
    async resend(ctx, id, options) {
      if (!idPattern.test(id)) throw new Error('媒体重发编号无效。');
      const record = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'));
      if (!sameRoute(currentMediaRoute(ctx), record.route)) throw new Error('只能在原会话中由原请求用户重发媒体。');
      await isAuthorized(ctx, record.capability);
      return send(ctx, record, options);
    }
  };
}
