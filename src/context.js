import { parseConversation } from './identity.js';

const first = (...values) => values.find(value => typeof value === 'string' && value);
export const channelOf = ctx => first(ctx?.messageChannel, ctx?.channel, ctx?.nativeChannelId, ctx?.deliveryContext?.channel, ctx?.channelId);
export const senderOf = ctx => first(ctx?.requesterSenderId, ctx?.senderId, ctx?.deliveryContext?.senderId);
export const conversationOf = ctx => first(ctx?.deliveryContext?.to, ctx?.conversationId, ctx?.from, ctx?.chatId);
export function scopeOf(ctx) {
  const channel = channelOf(ctx);
  const conversation = conversationOf(ctx);
  const parsed = parseConversation(channel, conversation);
  return { channel, accountId: ctx?.deliveryContext?.accountId ?? ctx?.accountId ?? ctx?.agentAccountId ?? 'default', senderId: senderOf(ctx), conversationId: conversation, kind: parsed?.kind, peerId: parsed?.id, threadId: String(ctx?.deliveryContext?.threadId ?? ctx?.messageThreadId ?? ctx?.threadId ?? '') };
}
export function conversationKey(ctx) {
  const scope = scopeOf(ctx);
  return JSON.stringify([scope.channel, scope.accountId, scope.kind, scope.peerId ?? scope.conversationId, scope.threadId]);
}
export function sameOwner(a, b) {
  return conversationKey(a) === conversationKey(b) && senderOf(a) === senderOf(b);
}
