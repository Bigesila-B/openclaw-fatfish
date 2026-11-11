import { randomUUID } from 'node:crypto';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { channelOf, senderOf, conversationKey } from './context.js';

const within = (root, path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const keyOf = ctx => JSON.stringify([channelOf(ctx), ctx.accountId ?? ctx.agentAccountId ?? ctx.deliveryContext?.accountId ?? 'default', ctx.sessionKey || conversationKey(ctx), senderOf(ctx)]);

export function createAttachmentRegistry({ stateDir, config = {}, fetchMedia, authorize, now = Date.now }) {
  const entries = new Map();
  function prune() {
    for (const [id, entry] of entries) if (entry.expires < now()) entries.delete(id);
    while (entries.size > 200) entries.delete(entries.keys().next().value);
  }
  function capture(event, ctx) {
    if (!senderOf(ctx) || !channelOf(ctx)) return;
    // 只读宿主已完成暂存的标准 media；不把 originalMedia.path 当成本地文件。
    const facts = Array.isArray(event.media) ? event.media : [];
    const owner = keyOf(ctx);
    for (const fact of facts.slice(0, 4)) {
      const kind = fact.kind ?? (fact.contentType?.startsWith('audio/') ? 'audio' : fact.contentType?.startsWith('video/') ? 'video' : null);
      if (!['audio', 'video'].includes(kind) || !fact.path && !fact.url) continue;
      const existing = [...entries.values()].some(entry => entry.owner === owner && entry.messageId && entry.messageId === (fact.messageId ?? event.messageId) && entry.path === fact.path && entry.url === fact.url);
      if (existing) continue;
      const id = randomUUID();
      entries.set(id, { id, owner, kind, path: fact.path, url: fact.url, workspaceDir: fact.workspaceDir, messageId: fact.messageId ?? event.messageId, expires: now() + (config.ttlMinutes ?? 10) * 60000 });
    }
    prune();
  }
  function list(ctx) {
    prune();
    return [...entries.values()].filter(entry => entry.owner === keyOf(ctx)).map(({ id, kind }) => ({ id, kind }));
  }
  async function read(ctx, kind, id) {
    const capability = kind === 'audio' ? 'stt' : 'watch';
    if (!await authorize(ctx, capability)) throw new Error('当前用户没有处理此附件的权限。');
    prune();
    const entry = id ? entries.get(id) : [...entries.values()].filter(item => item.owner === keyOf(ctx) && item.kind === kind).at(-1);
    if (!entry || entry.owner !== keyOf(ctx) || entry.kind !== kind) throw new Error('没有当前用户可用的附件；可能已过期，或通道没有提供标准媒体事实。请重新发送附件，视频也可提供 HTTPS 文件直链。');
    const maxBytes = (config.maxMb ?? 50) * 1024 ** 2;
    let buffer;
    if (entry.path) {
      const target = await realpath(entry.path);
      const roots = [join(stateDir, 'media'), entry.workspaceDir].filter(Boolean);
      let allowed = false;
      for (const root of roots) {
        try { if (within(await realpath(root), target)) allowed = true; } catch {}
      }
      if (!allowed) throw new Error('附件不在宿主管理的媒体目录或已声明的暂存目录内。');
      const stat = await lstat(target);
      if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error('附件为空或超过大小上限。');
      buffer = await readFile(target);
    } else {
      let url; try { url = new URL(entry.url); } catch { throw new Error('附件地址无效。'); }
      if (url.protocol !== 'https:' || url.username || url.password || typeof fetchMedia !== 'function') throw new Error('通道未提供可安全读取的附件，请重新上传或提供 HTTPS 文件直链。');
      try { buffer = (await fetchMedia({ url: url.href, maxBytes, maxRedirects: 0, timeoutMs: 60000 })).buffer; }
      catch { throw new Error('无法安全获取附件，请检查地址、大小或有效期。'); }
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw new Error('附件为空或超过大小上限。');
    if (!await authorize(ctx, capability)) throw new Error('附件处理权限已撤销。');
    return { buffer, id: entry.id, kind };
  }
  return { capture, list, read };
}
