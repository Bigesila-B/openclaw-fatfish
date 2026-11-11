import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHANNELS,
  channelLabel,
  isBlacklistId,
  isGroupConversation,
  isTrustedChannel,
  isValidSenderId,
  normalizeChannels,
  parseConversation
} from '../src/identity.js';

test('默认同时信任 SnowLuma 与官方 QQBot 通道', () => {
  assert.deepEqual(DEFAULT_CHANNELS, ['snowluma', 'qqbot']);
  assert.equal(isTrustedChannel('snowluma'), true);
  assert.equal(isTrustedChannel('qqbot'), true);
  assert.equal(isTrustedChannel('QQBot'), true, '通道 ID 大小写不应影响判断');
  assert.equal(isTrustedChannel('telegram'), false);
  assert.equal(isTrustedChannel(undefined), false);
});

test('非法或不存在的通道配置回落到默认列表', () => {
  assert.deepEqual(normalizeChannels(undefined), ['snowluma', 'qqbot']);
  assert.deepEqual(normalizeChannels([]), ['snowluma', 'qqbot']);
  assert.deepEqual(normalizeChannels([' QQBot ', 'qqbot', 'snowluma']), ['qqbot', 'snowluma']);
  // 全部非法时不能变成“什么都不信任”以外的空列表，仍使用默认值。
  assert.deepEqual(normalizeChannels(['A B', '中文']), ['snowluma', 'qqbot']);
  assert.deepEqual(normalizeChannels(['qqbot']), ['qqbot']);
});

test('两个通道的用户标识格式不同', () => {
  assert.equal(isValidSenderId('snowluma', '123456'), true);
  assert.equal(isValidSenderId('snowluma', 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6'), false, 'SnowLuma 只认 QQ 号');
  assert.equal(isValidSenderId('qqbot', 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6'), true);
  assert.equal(isValidSenderId('qqbot', 'a1b2-c3d4_e5f6'), true);
  assert.equal(isValidSenderId('qqbot', ''), false);
  assert.equal(isValidSenderId('qqbot', '-leading'), false);
  assert.equal(isValidSenderId('other', '123456'), false);
});

test('可以通过配置收窄可信通道', () => {
  assert.equal(isValidSenderId('snowluma', '123456', ['qqbot']), false);
  assert.equal(isValidSenderId('qqbot', 'A1B2C3D4E5F6', ['qqbot']), true);
});

test('会话标识同时兼容带通道前缀和不带前缀的写法', () => {
  assert.deepEqual(parseConversation('snowluma', 'group:222222'), { kind: 'group', id: '222222' });
  assert.deepEqual(parseConversation('snowluma', 'snowluma:group:222222'), { kind: 'group', id: '222222' });
  assert.deepEqual(parseConversation('snowluma', 'private:111111'), { kind: 'private', id: '111111' });
  assert.deepEqual(parseConversation('qqbot', 'c2c:A1B2C3D4'), { kind: 'private', id: 'A1B2C3D4' });
  assert.deepEqual(parseConversation('qqbot', 'qqbot:group:G1'), { kind: 'group', id: 'G1' });
  // 频道（guild channel）按群处理，避免被当成私聊绕过群黑名单。
  assert.deepEqual(parseConversation('qqbot', 'channel:C1'), { kind: 'group', id: 'C1' });
  assert.equal(parseConversation('qqbot', 'G1'), undefined);
  assert.equal(parseConversation('qqbot', ''), undefined);
  assert.equal(parseConversation('qqbot', undefined), undefined);
  assert.equal(isGroupConversation('qqbot', 'group:G1'), true);
  assert.equal(isGroupConversation('qqbot', 'c2c:U1'), false);
});

test('黑名单标识同时接受 QQ 号与 openid', () => {
  assert.equal(isBlacklistId('123456'), true);
  assert.equal(isBlacklistId('A1B2C3D4E5F6A7B8'), true);
  assert.equal(isBlacklistId('a1b2-c3d4'), true);
  assert.equal(isBlacklistId('abc'), false, '过短的标识视为无效');
  assert.equal(isBlacklistId(''), false);
  assert.equal(isBlacklistId('中文标识'), false);
});

test('通道中文名用于给用户看提示', () => {
  assert.equal(channelLabel('qqbot'), 'QQ 官方机器人');
  assert.equal(channelLabel('snowluma'), 'SnowLuma（OneBot）');
  assert.equal(channelLabel('telegram'), 'telegram');
  assert.equal(channelLabel(undefined), '未知通道');
});
