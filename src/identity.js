// 不同 QQ 接入方式的身份差异集中在这里处理，避免各处散落 channel === 'snowluma' 的判断。
//
// - snowluma：OpenClaw 通过第三方 OneBot 通道接入，用户标识是 QQ 号（5-15 位数字）。
// - qqbot：QQ 开放平台官方机器人，用户标识是 openid（不是 QQ 号，且每个机器人各自一套）。
//
// 两者的会话标识都由 OpenClaw 归一化成 "<kind>:<id>"，例如 group:222222、c2c:OPENID；
// 个别调用点仍会带上通道前缀，所以解析时统一按需剥离。

export const DEFAULT_CHANNELS = ['snowluma', 'qqbot'];

export const CHANNEL_LABELS = {
  snowluma: 'SnowLuma（OneBot）',
  qqbot: 'QQ 官方机器人'
};

const qqNumberPattern = /^[0-9]{5,15}$/;
// openid 是平台下发的不可读标识，通常 32 位，允许字母、数字、连字符和下划线。
const openIdPattern = /^[0-9A-Za-z][0-9A-Za-z_-]{5,63}$/;

const senderPatterns = { snowluma: qqNumberPattern, qqbot: openIdPattern };

// 配置里允许的通道 ID：小写字母、数字、连字符、下划线。
const channelPattern = /^[a-z0-9_-]{2,32}$/;

export function normalizeChannels(list) {
  if (!Array.isArray(list) || !list.length) return [...DEFAULT_CHANNELS];
  const values = list
    .filter(value => typeof value === 'string' && channelPattern.test(value.trim().toLowerCase()))
    .map(value => value.trim().toLowerCase());
  return values.length ? [...new Set(values)] : [...DEFAULT_CHANNELS];
}

export function isTrustedChannel(channel, trusted = DEFAULT_CHANNELS) {
  if (typeof channel !== 'string') return false;
  return normalizeChannels(trusted).includes(channel.trim().toLowerCase());
}

// 通道可信 + 标识格式正确，才算拿到可用的身份。任一条件不满足都按不可验证处理。
export function isValidSenderId(channel, senderId, trusted = DEFAULT_CHANNELS) {
  if (!isTrustedChannel(channel, trusted)) return false;
  if (typeof senderId !== 'string' || !senderId) return false;
  const pattern = senderPatterns[channel.trim().toLowerCase()];
  return pattern ? pattern.test(senderId) : false;
}

export function channelLabel(channel) {
  if (typeof channel !== 'string') return '未知通道';
  return CHANNEL_LABELS[channel.trim().toLowerCase()] ?? channel;
}

// 解析 OpenClaw 归一化后的会话标识；无法判断时返回 undefined，由调用方按 fail-closed 处理。
export function parseConversation(channel, conversationId) {
  if (typeof conversationId !== 'string') return undefined;
  let value = conversationId.trim();
  if (!value) return undefined;
  if (typeof channel === 'string' && channel) {
    const prefix = `${channel.trim().toLowerCase()}:`;
    if (value.toLowerCase().startsWith(prefix)) value = value.slice(prefix.length);
  }
  // 官方通道的会话类型带数字（c2c），所以不能只匹配字母。
  const match = /^([a-z][a-z0-9]*):([\s\S]+)$/i.exec(value);
  if (!match) return undefined;
  const kind = match[1].toLowerCase();
  const id = match[2];
  if (!id) return undefined;
  // 频道（guild channel）是公开场景，按群处理。
  if (kind === 'group' || kind === 'channel' || kind === 'guild') return { kind: 'group', id };
  if (kind === 'private' || kind === 'c2c' || kind === 'dm' || kind === 'direct' || kind === 'user') return { kind: 'private', id };
  return undefined;
}

export function isGroupConversation(channel, conversationId) {
  return parseConversation(channel, conversationId)?.kind === 'group';
}

// 黑名单条目既可能是 QQ 号（SnowLuma），也可能是 openid（官方机器人）。
export function isBlacklistId(value) {
  return typeof value === 'string' && (qqNumberPattern.test(value) || openIdPattern.test(value));
}

// 管理员条目允许 QQ 号与 openid 混用，便于同一份配置切换接入方式。
export function isAdminId(value) {
  return isBlacklistId(value);
}
