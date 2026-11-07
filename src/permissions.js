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

export function makeAdminCommand({ admins, store, generate, personaStore }) {
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
      const personaMatch = /^persona(?:\s+([\s\S]+))?$/.exec((ctx.args ?? '').trim());
      if (personaMatch) {
        if (!personaStore) return { text: '人格功能不可用。' };
        const action = personaMatch[1] ?? 'status';
        if (action === 'status') {
          const persona = await personaStore.read();
          return { text: `人格提示词：${persona.enabled ? '已启用' : '已关闭'}；${persona.prompt ? `已配置 ${persona.prompt.length} 个字符` : '尚未配置'}。用法：/fish persona set 人格描述；/fish persona on|off|reset` };
        }
        const set = /^set\s+([\s\S]+)$/.exec(action);
        try {
          if (set) await personaStore.change({ type: 'set', prompt: set[1] });
          else if (action === 'on' || action === 'off') await personaStore.change({ type: 'enabled', enabled: action === 'on' });
          else if (action === 'reset') await personaStore.change({ type: 'reset' });
          else return { text: '用法：/fish persona set 人格描述；/fish persona on|off|reset' };
        } catch (error) {
          if (error.message === '人格配置无效。') return { text: '人格描述不能为空，且不能超过 1500 个字符；启用前请先设置描述。' };
          throw error;
        }
        return { text: action === 'reset' ? '已恢复配置文件中的人格设置。' : '人格设置已保存，后续 QQ 聊天生效；是否应用还取决于 OpenClaw 钩子权限。' };
      }
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
