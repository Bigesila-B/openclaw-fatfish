import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CHANNELS, isBlacklistId, isTrustedChannel, isValidSenderId, parseConversation } from './identity.js';

const maxEntries = 1000;

function validate(value) {
  if (!value || !Array.isArray(value.users) || !Array.isArray(value.groups)) throw new Error('黑名单格式错误。');
  for (const items of [value.users, value.groups]) {
    if (items.length > maxEntries || items.some(id => !isBlacklistId(id)) || new Set(items).size !== items.length) throw new Error('黑名单格式错误。');
  }
  return { users: [...value.users], groups: [...value.groups] };
}

export function createBlacklistStore(stateDir, initial = {}) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw 状态目录不可用');
  const file = join(stateDir, 'fatfish', 'blacklist.json');
  const fallback = validate({ users: initial.users ?? [], groups: initial.groups ?? [] });
  let pending = Promise.resolve();
  async function read() {
    try { return validate(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return validate(fallback); throw error; }
  }
  function change(action, kind, id) {
    if (!['add', 'remove'].includes(action) || !['user', 'group'].includes(kind) || !isBlacklistId(id)) return Promise.reject(new Error('无效的黑名单操作。'));
    const update = pending.then(async () => {
      const policy = await read();
      const key = kind === 'user' ? 'users' : 'groups';
      policy[key] = action === 'add' ? [...new Set([...policy[key], id])] : policy[key].filter(item => item !== id);
      validate(policy);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(policy, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temp, file);
      } finally { await unlink(temp).catch(() => {}); }
      return policy;
    });
    pending = update.catch(() => {});
    return update;
  }
  return { read, change };
}

// 通道不可信时一律不拦（交给通道自身策略），但在可信通道上拿不到可用标识时按关闭处理。
export function shouldBlock(policy, identity, trusted = DEFAULT_CHANNELS) {
  const channel = identity?.channel;
  if (!isTrustedChannel(channel, trusted)) return false;
  const sender = isValidSenderId(channel, identity?.senderId, trusted) ? identity.senderId : undefined;
  const parsed = parseConversation(channel, identity?.conversationId);
  // 个别调用点只给裸群标识，补一条兜底解析。
  const group = parsed?.kind === 'group'
    ? parsed.id
    : (identity?.isGroup === true && isBlacklistId(identity?.conversationId) ? identity.conversationId : undefined);
  // 有生效名单却完全看不出会话是什么，按关闭处理；能判断是私聊则不算失败。
  if (policy.users.length && !sender) return true;
  if (policy.groups.length && !parsed && !group) return true;
  return Boolean((sender && policy.users.includes(sender)) || (group && policy.groups.includes(group)));
}

export function makeBlacklistHook(store, logger, trusted = DEFAULT_CHANNELS) {
  return async (event, ctx) => {
    const channel = ctx?.channelId ?? event?.channel;
    if (!isTrustedChannel(channel, trusted)) return;
    try {
      if (shouldBlock(await store.read(), { channel, senderId: ctx?.senderId ?? event?.senderId, conversationId: ctx?.conversationId, isGroup: event?.isGroup }, trusted)) return { handled: true };
    } catch {
      logger?.error?.('无法读取大肥鱼黑名单；本次 QQ 消息已阻止。');
      return { handled: true };
    }
  };
}
