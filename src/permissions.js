import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const capabilities = ['image', 'video'];

export function isAdmin(identity, admins) {
  return identity?.channel === 'snowluma' && typeof identity.senderId === 'string' &&
    /^[0-9]{5,15}$/.test(identity.senderId) && Array.isArray(admins) && admins.includes(identity.senderId);
}

export function canUse(identity, admins, policy, capability) {
  if (!capabilities.includes(capability)) return false;
  if (identity?.channel !== 'snowluma' || typeof identity.senderId !== 'string' || !/^[0-9]{5,15}$/.test(identity.senderId)) return false;
  return isAdmin(identity, admins) || policy?.[capability] === true;
}

export function createPolicyStore(stateDir) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw 状态目录不可用');
  const file = join(stateDir, 'fatfish', 'permissions.json');
  let pending = Promise.resolve();
  async function read() {
    let raw;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { image: false, video: false };
      throw error;
    }
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.image !== 'boolean' || typeof obj.video !== 'boolean') throw new Error('权限文件格式错误');
    return { image: obj.image, video: obj.video };
  }
  function set(capability, enabled) {
    if (!capabilities.includes(capability) || typeof enabled !== 'boolean') return Promise.reject(new Error('无效权限'));
    const update = pending.then(async () => {
      const policy = await read();
      policy[capability] = enabled;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(policy, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return policy;
    });
    pending = update.catch(() => {});
    return update;
  }
  return { read, set };
}

export function makeAdminCommand({ admins, store, generate }) {
  return {
    name: 'fish',
    description: '大肥鱼管理员权限设置',
    acceptsArgs: true,
    requireAuth: true,
    async handler(ctx) {
      const identity = { channel: ctx.channel, senderId: ctx.senderId };
      const match = /^(image|video)\s+([\s\S]+)$/.exec((ctx.args ?? '').trim());
      if (match) {
        if (ctx.isAuthorizedSender !== true || !canUse(identity, admins, await store.read(), match[1])) return { text: '当前 QQ 用户没有使用此功能的权限，或身份不可验证。' };
        if (!generate) return { text: '此功能尚未配置。' };
        const result = await generate(match[1], match[2]);
        if (!canUse(identity, admins, await store.read(), match[1])) return { text: '生成期间权限发生变化，无法发送结果。' };
        return { text: '生成完成。', mediaUrl: result.filePath };
      }
      if (ctx.isAuthorizedSender !== true || !isAdmin(identity, admins)) return { text: '仅限已配置并通过通道授权的 QQ 管理员使用。' };
      const args = (ctx.args ?? '').trim().split(/\s+/);
      if (args.length === 1 && (args[0] === '' || args[0] === 'permissions')) {
        const policy = await store.read();
        return { text: `普通用户权限：生图 ${policy.image ? '允许' : '禁止'}；视频 ${policy.video ? '允许' : '禁止'}。功能仍须由管理员配置并启用。用法：/fish allow image|video on|off` };
      }
      if (args.length !== 3 || args[0] !== 'allow' || !capabilities.includes(args[1]) || !['on', 'off'].includes(args[2])) {
        return { text: '用法：/fish permissions 或 /fish allow image|video on|off' };
      }
      await store.set(args[1], args[2] === 'on');
      return { text: `已${args[2] === 'on' ? '允许' : '禁止'}普通用户使用${args[1] === 'image' ? '生图' : '视频'}；功能仍须由管理员配置并启用。` };
    }
  };
}
