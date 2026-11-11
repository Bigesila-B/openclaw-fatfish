import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { shouldBlock } from './blacklist.js';
import { DEFAULT_CHANNELS, channelLabel, isBlacklistId, isValidSenderId, parseConversation } from './identity.js';
import { capabilityIds as capabilities, CAPABILITIES } from './capabilities.js';

const helpText = [
  '🐟 大肥鱼指令列表',
  '/fish 或 /fish help — 查看指令列表',
  '/fish whoami — 查看当前通道、用户标识和会话',
  '/fish status [image|text] — 查看状态面板；完整信息仅管理员私聊可见',
  '/fish tasks — 列出当前会话中自己的生成任务',
  '/fish task 编号 — 查询生成任务',
  '/fish task resume|cancel|send 编号 — 恢复查询、取消本地任务或重发结果',
  '/fish image 提示词 — 生成图片',
  '/fish video 提示词 — 生成视频',
  '/fish sticker 关键词 — 发送匹配的表情包',
  '/fish resend 编号 [file] — 在原会话重发已有媒体；file 表示按附件发送',
  '',
  '以下指令仅管理员可操作：',
  '/fish panel settings — 查看面板设置',
  '/fish panel on|off|image|text — 开关面板或设置默认格式',
  '/fish panel theme dark|light — 设置面板主题',
  '/fish panel public on|off — 开关普通用户功能简报',
  '/fish permissions — 查看普通用户权限',
  '/fish allow image|video|watch|sticker|tts|parse|stt on|off — 设置普通用户权限',
  '/fish allow 功能 on|off|inherit user|group 标识 — 设置或恢复当前机器人下的单人或单群权限',
  '/fish parse status|on|off — 开关媒体解析',
  '/fish persona status — 查看人格状态',
  '/fish persona set 人格描述 — 设置人格',
  '/fish persona on|off|reset — 启用、关闭或恢复人格',
  '/fish blacklist list — 查看黑名单',
  '/fish blacklist add|remove user|group 标识 — 管理黑名单',
  '',
  '看视频和语音可通过自然语言请求；功能需先配置、启用并授权。竖线表示选一项。',
  '官方机器人拿不到 QQ 号，管理员标识用 /fish whoami 查到的 openid。',
  '服务器终端命令：openclaw fatfish --help'
].join('\n');

// 通道只决定身份是否可信；具体能用哪项功能仍由 admins 和 /fish allow 决定。
export function isAdmin(identity, admins, trusted = DEFAULT_CHANNELS) {
  if (!isValidSenderId(identity?.channel, identity?.senderId, trusted)) return false;
  return Array.isArray(admins) && admins.includes(identity.senderId);
}

export function canUse(identity, admins, policy, capability, trusted = DEFAULT_CHANNELS) {
  if (!capabilities.includes(capability)) return false;
  if (!isValidSenderId(identity?.channel, identity?.senderId, trusted)) return false;
  if (isAdmin(identity, admins, trusted)) return true;
  const scopeKey = (kind, id) => JSON.stringify([identity.channel, identity.accountId ?? 'default', kind, id]);
  const user = policy?.overrides?.[scopeKey('user', identity.senderId)]?.[capability];
  if (typeof user === 'boolean') return user;
  const parsed = parseConversation(identity.channel, identity.conversationId);
  const group = parsed?.kind === 'group' ? policy?.overrides?.[scopeKey('group', parsed.id)]?.[capability] : undefined;
  return typeof group === 'boolean' ? group : policy?.[capability] === true;
}

export function createPolicyStore(stateDir) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw 状态目录不可用');
  const file = join(stateDir, 'fatfish', 'permissions.json');
  let pending = Promise.resolve();
  async function read() {
    let raw;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return Object.fromEntries(capabilities.map(id => [id, false]));
      throw error;
    }
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.image !== 'boolean' || typeof obj.video !== 'boolean' || capabilities.some(id => obj[id] !== undefined && typeof obj[id] !== 'boolean')) throw new Error('权限文件格式错误');
    if (obj.overrides !== undefined && (!obj.overrides || typeof obj.overrides !== 'object' || Array.isArray(obj.overrides) || Object.keys(obj.overrides).length > 1000 || Object.values(obj.overrides).some(rule => !rule || typeof rule !== 'object' || Object.entries(rule).some(([key, value]) => !capabilities.includes(key) || typeof value !== 'boolean')))) throw new Error('权限文件格式错误');
    return { ...Object.fromEntries(capabilities.map(id => [id, obj[id] ?? false])), ...(obj.overrides ? { overrides: obj.overrides } : {}) };
  }
  function set(capability, enabled, scope) {
    if (!capabilities.includes(capability) || typeof enabled !== 'boolean' && !(scope && enabled === null)) return Promise.reject(new Error('无效权限'));
    const update = pending.then(async () => {
      const policy = await read();
      if (scope) {
        if (!['user', 'group'].includes(scope.kind) || !isBlacklistId(scope.id) || !DEFAULT_CHANNELS.includes(scope.channel)) throw new Error('无效权限范围');
        const key = JSON.stringify([scope.channel, scope.accountId ?? 'default', scope.kind, scope.id]);
        policy.overrides ??= {};
        if (enabled === null) {
          if (policy.overrides[key]) { delete policy.overrides[key][capability]; if (!Object.keys(policy.overrides[key]).length) delete policy.overrides[key]; }
        } else policy.overrides[key] = { ...(policy.overrides[key] ?? {}), [capability]: enabled };
        if (Object.keys(policy.overrides).length > 1000) throw new Error('权限规则已达上限。');
      } else policy[capability] = enabled;
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

export function makeAdminCommand({ admins, store, generate, personaStore, blacklistStore, stickerStore, stickerCooldown, stickerConfig, parseState, mediaDelivery, statusService, taskManager, trustedChannels = DEFAULT_CHANNELS }) {
  const trusted = trustedChannels;
  // 各调用点给的字段名不统一，这里统一判断身份是否可用。
  const verified = identity => isValidSenderId(identity?.channel, identity?.senderId, trusted);
  return {
    name: 'fish',
    description: '大肥鱼指令列表与功能管理',
    acceptsArgs: true,
    requireAuth: true,
    async handler(ctx) {
      const identity = { channel: ctx.channel, senderId: ctx.senderId, accountId: ctx.accountId ?? 'default', conversationId: ctx.conversationId ?? ctx.from };
      // 不同调用点给的会话字段不统一，这里同时兼容 conversationId 和 from。
      const conversationId = ctx.conversationId ?? ctx.from;
      if (blacklistStore && verified(identity)) {
        try {
          if (shouldBlock(await blacklistStore.read(), { ...identity, conversationId }, trusted)) {
            return { text: '已忽略：当前来源在黑名单中，或身份不可验证。' };
          }
        } catch {
          return { text: '已忽略：无法读取黑名单配置，按安全策略不放行。' };
        }
      }
      const commandArgs = (ctx.args ?? '').trim();
      // 官方机器人拿不到 QQ 号，管理员需要靠这条指令查自己的 openid。
      // 放在其它校验之前，避免身份格式与通道不匹配时反而看不到排查线索。
      if (commandArgs === 'whoami') {
        const admin = isAdmin(identity, admins, trusted);
        return {
          text: [
            `通道：${channelLabel(identity.channel)}（${identity.channel ?? '未知'}）`,
            `用户标识：${identity.senderId ?? '未知'}`,
            `会话：${conversationId ?? '未知'}`,
            `管理员：${admin ? '是' : '否'}`,
            `身份可用：${verified(identity) ? '是' : '否；当前通道不在可信列表内，或标识格式不正确'}`
          ].join('\n')
        };
      }
      if (commandArgs === '' || commandArgs === 'help') {
        if (ctx.isAuthorizedSender !== true || !verified(identity)) return { text: '当前 QQ 用户未通过通道授权，或身份不可验证。' };
        return { text: helpText };
      }
      const status = /^status(?:\s+(image|text))?$/.exec(commandArgs);
      if (status || /^panel(?:\s|$)/.test(commandArgs)) {
        if (ctx.isAuthorizedSender !== true || !verified(identity)) return { text: '当前 QQ 用户未通过通道授权，或身份不可验证。' };
        if (!statusService) return { text: '状态面板组件不可用。' };
        return status ? statusService.handle(ctx, status[1]) : statusService.configure(ctx, commandArgs.slice(5));
      }
      const task = /^task(?:s)?(?:\s+([\s\S]+))?$/.exec(commandArgs);
      if (task) {
        if (ctx.isAuthorizedSender !== true || !verified(identity)) return { text: '当前 QQ 用户未通过通道授权，或身份不可验证。' };
        if (!taskManager) return { text: '任务组件不可用。' };
        try { return await taskManager.command(ctx, task[1] ?? ''); }
        catch { return { text: '无法操作任务：请确认编号、当前权限，以及是否在原会话操作自己的任务。' }; }
      }
      const resend = /^resend\s+(\S+)(?:\s+(file))?$/.exec(commandArgs);
      if (resend) {
        if (ctx.isAuthorizedSender !== true || !verified(identity)) return { text: '当前 QQ 用户未通过通道授权，或身份不可验证。' };
        if (!mediaDelivery) return { text: '媒体重发功能不可用。' };
        try { return { text: (await mediaDelivery.resend(ctx, resend[1], { forceDocument: resend[2] === 'file' })).text }; }
        catch { return { text: '无法重发：请确认编号有效、仍有功能权限，且正在原请求用户的原会话中操作。' }; }
      }
      const stickerMatch = /^sticker\s+([\s\S]+)$/.exec((ctx.args ?? '').trim());
      if (stickerMatch) {
        if (ctx.isAuthorizedSender !== true || !canUse(identity, admins, await store.read(), 'sticker', trusted)) return { text: '当前 QQ 用户没有使用表情包的权限，或身份不可验证。' };
        if (stickerConfig?.enabled !== true || !stickerStore) return { text: '表情包功能未启用。' };
        const [candidate] = await stickerStore.search(stickerMatch[1], 1);
        if (!candidate) return { text: '没有找到匹配的表情包。' };
        const item = await stickerStore.get(candidate.id);
        if (!item) return { text: '表情包文件不可用。' };
        if (!canUse(identity, admins, await store.read(), 'sticker', trusted)) return { text: '表情包权限已变更。' };
        if (!stickerCooldown(conversationId ?? ctx.sessionKey)) return { text: '表情包发送太频繁，请稍后再试。' };
        if (mediaDelivery) return { text: (await mediaDelivery.deliver(ctx, 'sticker', [item.filePath])).text };
        return { mediaUrl: item.filePath };
      }
      const match = /^(image|video)\s+([\s\S]+)$/.exec((ctx.args ?? '').trim());
      if (match) {
        if (ctx.isAuthorizedSender !== true || !canUse(identity, admins, await store.read(), match[1], trusted)) return { text: '当前 QQ 用户没有使用此功能的权限，或身份不可验证。' };
        if (taskManager) return taskManager.submit(ctx, match[1], match[2]);
        if (!generate) return { text: '此功能尚未配置。' };
        if (mediaDelivery) await mediaDelivery.check(ctx, match[1]);
        const result = await generate(match[1], match[2]);
        if (!canUse(identity, admins, await store.read(), match[1], trusted)) return { text: '生成期间权限发生变化，无法发送结果。' };
        if (mediaDelivery) return { text: (await mediaDelivery.deliver(ctx, match[1], [result.filePath])).text };
        return { text: '生成完成。', mediaUrl: result.filePath };
      }
      if (ctx.isAuthorizedSender !== true || !isAdmin(identity, admins, trusted)) return { text: '仅限已配置并通过通道授权的 QQ 管理员使用。' };
      const blacklistMatch = /^blacklist(?:\s+([\s\S]+))?$/.exec((ctx.args ?? '').trim());
      if (blacklistMatch) {
        if (!blacklistStore) return { text: '黑名单功能不可用。' };
        const action = (blacklistMatch[1] ?? 'list').trim();
        if (action === 'list') {
          const policy = await blacklistStore.read();
          const summary = `黑名单：用户 ${policy.users.length} 个，群 ${policy.groups.length} 个。`;
          const ownPrivate = conversationId === `private:${ctx.senderId}` || conversationId === `${ctx.channel}:private:${ctx.senderId}`;
          if (!ownPrivate) return { text: `${summary} 在管理员私聊中查看号码。` };
          const format = items => items.slice(0, 20).join('、') || '无';
          return { text: `${summary}\n用户：${format(policy.users)}${policy.users.length > 20 ? ' 等' : ''}\n群：${format(policy.groups)}${policy.groups.length > 20 ? ' 等' : ''}\n每类最多显示前 20 个。` };
        }
        const match = /^(add|remove)\s+(user|group)\s+(\S+)$/.exec(action);
        // 官方机器人用 openid 做标识，所以这里同时接受 QQ 号和 openid。
        if (!match || !isBlacklistId(match[3])) return { text: '用法：/fish blacklist add|remove user|group 标识（QQ 号或 openid）' };
        await blacklistStore.change(match[1], match[2], match[3]);
        return { text: `已${match[1] === 'add' ? '加入' : '移出'}${match[2] === 'user' ? '用户' : '群'}黑名单。` };
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
        return { text: `普通用户默认权限：${CAPABILITIES.map(item => `${item.label} ${policy[item.id] ? '允许' : '禁止'}`).join('；')}。\n单人/单群规则 ${Object.keys(policy.overrides ?? {}).length} 条；优先级：黑名单 > 管理员 > 单人 > 单群 > 默认。功能仍须配置并启用。\n用法：/fish allow 功能 on|off；/fish allow 功能 on|off|inherit user|group 标识` };
      }
      if (![3, 5].includes(args.length) || args[0] !== 'allow' || !capabilities.includes(args[1]) || !['on', 'off', ...(args.length === 5 ? ['inherit'] : [])].includes(args[2]) || args.length === 5 && (!['user', 'group'].includes(args[3]) || !isBlacklistId(args[4]))) {
        return { text: '用法：/fish permissions 或 /fish allow 功能 on|off；/fish allow 功能 on|off|inherit user|group 标识' };
      }
      await store.set(args[1], args[2] === 'inherit' ? null : args[2] === 'on', args.length === 5 ? { kind: args[3], id: args[4], channel: ctx.channel, accountId: ctx.accountId } : undefined);
      if (args[2] === 'inherit') return { text: '已删除此项独立规则，恢复继承权限。' };
      return { text: `已${args[2] === 'on' ? '允许' : '禁止'}${args.length === 5 ? `${args[3] === 'user' ? '用户' : '群'} ${args[4]}` : '普通用户'}使用${CAPABILITIES.find(item => item.id === args[1]).label}；功能仍须由管理员配置并启用。` };
    }
  };
}
