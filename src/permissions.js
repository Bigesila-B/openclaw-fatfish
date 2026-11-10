import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { shouldBlock } from './blacklist.js';

const capabilities = ['image', 'video', 'watch', 'sticker', 'tts', 'parse'];
const helpText = [
  '🐟 大肥鱼指令列表',
  '/fish 或 /fish help — 查看指令列表',
  '/fish image 提示词 — 生成图片',
  '/fish video 提示词 — 生成视频',
  '/fish sticker 关键词 — 发送匹配的表情包',
  '',
  '以下指令仅管理员可操作：',
  '/fish permissions — 查看普通用户权限',
  '/fish allow image|video|watch|sticker|tts|parse on|off — 设置权限',
  '/fish parse status|on|off — 开关媒体解析',
  '/fish persona status — 查看人格状态',
  '/fish persona set 人格描述 — 设置人格',
  '/fish persona on|off|reset — 启用、关闭或恢复人格',
  '/fish blacklist list — 查看黑名单',
  '/fish blacklist add|remove user|group 号码 — 管理黑名单',
  '',
  '看视频和语音可通过自然语言请求；功能需先配置、启用并授权。竖线表示选一项。',
  '服务器终端命令：openclaw fatfish --help'
].join('\n');

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
      if (error.code === 'ENOENT') return { image: false, video: false, watch: false, sticker: false, tts: false, parse: false };
      throw error;
    }
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.image !== 'boolean' || typeof obj.video !== 'boolean' || (obj.watch !== undefined && typeof obj.watch !== 'boolean') || (obj.sticker !== undefined && typeof obj.sticker !== 'boolean') || (obj.tts !== undefined && typeof obj.tts !== 'boolean') || (obj.parse !== undefined && typeof obj.parse !== 'boolean')) throw new Error('权限文件格式错误');
    return { image: obj.image, video: obj.video, watch: obj.watch ?? false, sticker: obj.sticker ?? false, tts: obj.tts ?? false, parse: obj.parse ?? false };
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

export function makeAdminCommand({ admins, store, generate, personaStore, blacklistStore, stickerStore, stickerCooldown, stickerConfig, parseState }) {
  return {
    name: 'fish',
    description: '大肥鱼指令列表与功能管理',
    acceptsArgs: true,
    requireAuth: true,
    async handler(ctx) {
      const identity = { channel: ctx.channel, senderId: ctx.senderId };
      // 不同调用点给的会话字段不统一，这里同时兼容 conversationId 和 from。
      const conversationId = ctx.conversationId ?? ctx.from;
      if (blacklistStore && ctx.channel === 'snowluma') {
        try {
          if (shouldBlock(await blacklistStore.read(), { ...identity, conversationId })) {
            return { text: '已忽略：当前来源在黑名单中，或身份不可验证。' };
          }
        } catch {
          return { text: '已忽略：无法读取黑名单配置，按安全策略不放行。' };
        }
      }
      const commandArgs = (ctx.args ?? '').trim();
      if (commandArgs === '' || commandArgs === 'help') {
        if (ctx.isAuthorizedSender !== true || identity.channel !== 'snowluma' || typeof identity.senderId !== 'string' || !/^[0-9]{5,15}$/.test(identity.senderId)) return { text: '当前 QQ 用户未通过通道授权，或身份不可验证。' };
        return { text: helpText };
      }
      const stickerMatch = /^sticker\s+([\s\S]+)$/.exec((ctx.args ?? '').trim());
      if (stickerMatch) {
        if (ctx.isAuthorizedSender !== true || !canUse(identity, admins, await store.read(), 'sticker')) return { text: '当前 QQ 用户没有使用表情包的权限，或身份不可验证。' };
        if (stickerConfig?.enabled !== true || !stickerStore) return { text: '表情包功能未启用。' };
        const [candidate] = await stickerStore.search(stickerMatch[1], 1);
        if (!candidate) return { text: '没有找到匹配的表情包。' };
        const item = await stickerStore.get(candidate.id);
        if (!item) return { text: '表情包文件不可用。' };
        if (!canUse(identity, admins, await store.read(), 'sticker')) return { text: '表情包权限已变更。' };
        if (!stickerCooldown(conversationId ?? ctx.sessionKey)) return { text: '表情包发送太频繁，请稍后再试。' };
        return { mediaUrl: item.filePath };
      }
      const match = /^(image|video)\s+([\s\S]+)$/.exec((ctx.args ?? '').trim());
      if (match) {
        if (ctx.isAuthorizedSender !== true || !canUse(identity, admins, await store.read(), match[1])) return { text: '当前 QQ 用户没有使用此功能的权限，或身份不可验证。' };
        if (!generate) return { text: '此功能尚未配置。' };
        const result = await generate(match[1], match[2]);
        if (!canUse(identity, admins, await store.read(), match[1])) return { text: '生成期间权限发生变化，无法发送结果。' };
        return { text: '生成完成。', mediaUrl: result.filePath };
      }
      if (ctx.isAuthorizedSender !== true || !isAdmin(identity, admins)) return { text: '仅限已配置并通过通道授权的 QQ 管理员使用。' };
      const blacklistMatch = /^blacklist(?:\s+([\s\S]+))?$/.exec((ctx.args ?? '').trim());
      if (blacklistMatch) {
        if (!blacklistStore) return { text: '黑名单功能不可用。' };
        const action = (blacklistMatch[1] ?? 'list').trim();
        if (action === 'list') {
          const policy = await blacklistStore.read();
          const summary = `黑名单：QQ 用户 ${policy.users.length} 个，QQ群 ${policy.groups.length} 个。`;
          const ownPrivate = ctx.from === `snowluma:private:${ctx.senderId}` || ctx.from === `private:${ctx.senderId}`;
          if (!ownPrivate) return { text: `${summary} 在管理员私聊中查看号码。` };
          const format = items => items.slice(0, 20).join('、') || '无';
          return { text: `${summary}\n用户：${format(policy.users)}${policy.users.length > 20 ? ' 等' : ''}\n群：${format(policy.groups)}${policy.groups.length > 20 ? ' 等' : ''}\n每类最多显示前 20 个。` };
        }
        const match = /^(add|remove)\s+(user|group)\s+([0-9]{5,15})$/.exec(action);
        if (!match) return { text: '用法：/fish blacklist add|remove user|group 号码' };
        await blacklistStore.change(match[1], match[2], match[3]);
        return { text: `已${match[1] === 'add' ? '加入' : '移出'}${match[2] === 'user' ? 'QQ 用户' : 'QQ群'}黑名单。` };
      }
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
      const parseMatch = /^parse(?:\s+(status|on|off))?$/.exec((ctx.args ?? '').trim());
      if (parseMatch) {
        if (!parseState) return { text: '媒体解析开关不可用。' };
        const action = parseMatch[1] ?? 'status';
        let enabled;
        try { enabled = await parseState.read(); } catch { return { text: '媒体解析开关文件损坏，请检查状态目录中的 fatfish/parse.json。' }; }
        if (action === 'status') return { text: `媒体解析：${enabled ? '已启用' : '已关闭'}。普通用户还需要 parse 权限（/fish allow parse on）。` };
        await parseState.set(action === 'on');
        return { text: `媒体解析已${action === 'on' ? '启用' : '关闭'}。` };
      }
      const args = (ctx.args ?? '').trim().split(/\s+/);
      if (args.length === 1 && args[0] === 'permissions') {
        const policy = await store.read();
        return { text: `普通用户权限：生图 ${policy.image ? '允许' : '禁止'}；生视频 ${policy.video ? '允许' : '禁止'}；看视频 ${policy.watch ? '允许' : '禁止'}；表情包 ${policy.sticker ? '允许' : '禁止'}；语音合成 ${policy.tts ? '允许' : '禁止'}；媒体解析 ${policy.parse ? '允许' : '禁止'}。功能仍须由管理员配置并启用。用法：/fish allow image|video|watch|sticker|tts|parse on|off` };
      }
      if (args.length !== 3 || args[0] !== 'allow' || !capabilities.includes(args[1]) || !['on', 'off'].includes(args[2])) {
        return { text: '用法：/fish permissions 或 /fish allow image|video|watch|sticker on|off' };
      }
      await store.set(args[1], args[2] === 'on');
      return { text: `已${args[2] === 'on' ? '允许' : '禁止'}普通用户使用${{ image: '生图', video: '生视频', watch: '看视频', sticker: '表情包', tts: '语音合成', parse: '媒体解析' }[args[1]]}；功能仍须由管理员配置并启用。` };
    }
  };
}
