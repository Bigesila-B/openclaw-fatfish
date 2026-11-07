import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const idPattern = /^[0-9]{5,15}$/;
const maxEntries = 1000;

function validate(value) {
  if (!value || !Array.isArray(value.users) || !Array.isArray(value.groups)) throw new Error('黑名单格式错误。');
  for (const items of [value.users, value.groups]) {
    if (items.length > maxEntries || items.some(id => typeof id !== 'string' || !idPattern.test(id)) || new Set(items).size !== items.length) throw new Error('黑名单格式错误。');
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
    if (!['add', 'remove'].includes(action) || !['user', 'group'].includes(kind) || typeof id !== 'string' || !idPattern.test(id)) return Promise.reject(new Error('无效的黑名单操作。'));
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

export function shouldBlock(policy, identity) {
  if (identity?.channel !== 'snowluma') return false;
  const sender = typeof identity.senderId === 'string' && idPattern.test(identity.senderId) ? identity.senderId : undefined;
  const conversation = typeof identity.conversationId === 'string' ? identity.conversationId.replace(/^snowluma:/, '') : '';
  const match = /^(group|private):([0-9]{5,15})$/.exec(conversation);
  const group = match?.[1] === 'group' ? match[2] : (identity.isGroup === true && idPattern.test(conversation) ? conversation : undefined);
  // Without a trustworthy ID, fail closed when an active list requires it.
  if (policy.users.length && !sender) return true;
  if (policy.groups.length && !match && !group) return true;
  return Boolean((sender && policy.users.includes(sender)) || (group && policy.groups.includes(group)));
}

export function makeBlacklistHook(store, logger) {
  return async (event, ctx) => {
    if ((ctx?.channelId ?? event?.channel) !== 'snowluma') return;
    try {
      if (shouldBlock(await store.read(), { channel: 'snowluma', senderId: ctx?.senderId ?? event?.senderId, conversationId: ctx?.conversationId, isGroup: event?.isGroup })) return { handled: true };
    } catch {
      logger?.error?.('无法读取大肥鱼黑名单；本次 QQ 消息已阻止。');
      return { handled: true };
    }
  };
}
