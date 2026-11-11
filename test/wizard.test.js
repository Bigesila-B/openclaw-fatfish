import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatch, buildQQBotPatch, parseChannelChoice, parseIds, parseWsUrl, runWizard } from '../src/wizard.js';

test('wizard validates QQ IDs and SnowLuma addresses', () => {
  assert.deepEqual(parseIds('123456, 234567，123456', true), ['123456', '234567']);
  assert.throws(() => parseIds('', true));
  assert.throws(() => parseIds('abc'));
  assert.equal(parseWsUrl('ws://127.0.0.1:3001'), 'ws://127.0.0.1:3001/');
  assert.throws(() => parseWsUrl('ws://user:secret@localhost:3001'));
  assert.throws(() => parseWsUrl('ws://localhost:3001/?token=abc'));
  assert.throws(() => parseWsUrl('https://example.com'));
});

test('openid 解析只接受平台下发的标识格式', () => {
  assert.deepEqual(parseIds('A1B2C3D4E5F6, a1b2-c3d4', false, 'openid'), ['A1B2C3D4E5F6', 'a1b2-c3d4']);
  assert.deepEqual(parseIds('', false, 'openid'), []);
  assert.throws(() => parseIds('', true, 'openid'));
  assert.throws(() => parseIds('中文', false, 'openid'));
});

test('接入方式选择同时接受数字与名称', () => {
  assert.equal(parseChannelChoice('1'), 'qqbot');
  assert.equal(parseChannelChoice('qqbot'), 'qqbot');
  assert.equal(parseChannelChoice('2'), 'snowluma');
  assert.equal(parseChannelChoice('OneBot'), 'snowluma');
  assert.throws(() => parseChannelChoice('3'));
});

test('config patch only targets requested settings and does not grant optional tools', () => {
  const patch = buildPatch({ wsUrl: 'ws://localhost:3001/', token: 'token', admins: ['123456'], groups: ['345678'], persona: '' });
  assert.deepEqual(patch.channels.snowluma.allowFrom, ['private:123456', 'group:345678']);
  assert.equal(patch.tools, undefined);
  assert.equal(patch.plugins.entries.fatfish.config.persona, undefined);

  // 群号留空时不做通道级限制：任何人都能私聊，群里 @ 也能触发。
  const open = buildPatch({ wsUrl: 'ws://localhost:3001/', token: 'token', admins: ['123456'], groups: [], persona: '' });
  assert.equal(open.channels.snowluma.allowFrom, undefined);
});

test('显式开启时才写入 tools.alsoAllow，且不会变成严格白名单', () => {
  const patch = buildPatch({ wsUrl: 'ws://localhost:3001/', token: 'token', admins: ['123456'], groups: [], persona: '', enableTools: true });
  // 用 alsoAllow 追加，避免 tools.allow 那种严格白名单把核心工具一起关掉。
  assert.deepEqual(patch.tools, { alsoAllow: ['fatfish'] });
  assert.equal(patch.tools.allow, undefined);
});

test('官方 QQBot 的配置补丁写入 AppID/AppSecret 且不覆盖来源限制', () => {
  const openid = 'A1B2C3D4E5F6A7B8';
  const patch = buildQQBotPatch({ appId: '102030405', clientSecret: 'secret-value', admins: [openid], persona: '', enableTools: true });
  assert.deepEqual(patch.channels.qqbot, { enabled: true, appId: '102030405', clientSecret: 'secret-value' });
  // 官方机器人默认只有创建者可用，这里不写 allowFrom，保留“不限制来源”的默认行为。
  assert.equal(patch.channels.qqbot.allowFrom, undefined);
  assert.deepEqual(patch.plugins.entries.fatfish.config.admins, [openid]);
  assert.deepEqual(patch.tools, { alsoAllow: ['fatfish'] });
  assert.equal(patch.channels.snowluma, undefined, '不应顺带改动 SnowLuma 配置');
});

test('QQBot 向导写入 qqbot 通道并隐藏 AppSecret', async () => {
  const confirmations = [false, true, false, true, false];
  const answers = ['102030405', ''];
  const output = [], calls = [];
  const ui = {
    print: text => output.push(text),
    confirm: async () => confirmations.shift(),
    askValid: async (_label, _default, parse) => parse(answers.shift()),
    secret: async () => 'secret-value'
  };
  const cli = {
    interactive: async args => { calls.push(['interactive', args]); return 0; },
    capture: async args => {
      calls.push(['capture', args]);
      return { code: 0, stdout: args[0] === 'plugins' ? JSON.stringify({ plugins: [{ id: 'qqbot', enabled: true }] }) : '{}' };
    },
    input: async (args, input) => { calls.push(['input', args, input]); return { code: 0 }; }
  };
  assert.deepEqual(await runWizard(ui, cli, async () => true, { channel: 'qqbot' }), { completed: true });
  const writes = calls.filter(entry => entry[0] === 'input');
  assert.equal(writes.length, 2);
  const applied = JSON.parse(writes[1][2]);
  assert.equal(applied.channels.qqbot.appId, '102030405');
  assert.equal(applied.channels.qqbot.clientSecret, 'secret-value');
  assert.equal(applied.tools, undefined, '未开启时不写 tools.alsoAllow');
  assert.doesNotMatch(output.join('\n'), /secret-value/, 'AppSecret 不能出现在终端输出里');
});

test('wizard previews and applies the same patch without displaying the token', async () => {
  const confirmations = [false, true, true, false, true, false];
  const answers = ['ws://127.0.0.1:3001/', '123456', '345678', '友善的小鱼'];
  const output = [], calls = [];
  const ui = {
    print: text => output.push(text),
    confirm: async () => confirmations.shift(),
    askValid: async (_label, _default, parse) => parse(answers.shift()),
    secret: async () => 'private-token'
  };
  const cli = {
    interactive: async args => { calls.push(['interactive', args]); return 0; },
    capture: async args => { calls.push(['capture', args]); return { code: 0, stdout: args[0] === 'plugins' && args[1] === 'list' ? JSON.stringify({ plugins: [{ id: 'openclaw-snowluma', enabled: true }] }) : JSON.stringify({ plugin: { status: 'loaded' } }) }; },
    input: async (args, input) => { calls.push(['input', args, input]); return { code: 0 }; }
  };
  assert.deepEqual(await runWizard(ui, cli, async () => true), { completed: true });
  const writes = calls.filter(entry => entry[0] === 'input');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0][1], ['config', 'patch', '--stdin', '--dry-run']);
  assert.equal(writes[0][2], writes[1][2]);
  assert.equal(JSON.parse(writes[1][2]).channels.snowluma.accessToken, 'private-token');
  assert.doesNotMatch(output.join('\n'), /private-token/);
  assert.equal(calls.some(entry => entry[0] === 'interactive'), false);
});

test('wizard does not change QQ configuration if SnowLuma cannot be reached', async () => {
  const confirmations = [false, true];
  const answers = ['ws://localhost:3001', '123456', ''];
  const ui = { print() {}, confirm: async () => confirmations.shift(), askValid: async (_label, _default, parse) => parse(answers.shift()), secret: async () => 'token' };
  const cli = { interactive: async () => { throw Error('unexpected'); }, capture: async () => { throw Error('unexpected'); }, input: async () => { throw Error('unexpected'); } };
  assert.deepEqual(await runWizard(ui, cli, async () => false), { completed: false, reason: 'port-unreachable' });
});

test('wizard stops without applying config when dry run fails', async () => {
  const confirmations = [false, true, false, false, true];
  const answers = ['ws://localhost:3001', '123456', ''];
  const ui = { print() {}, confirm: async () => confirmations.shift(), askValid: async (_label, _default, parse) => parse(answers.shift()), secret: async () => 'token' };
  let writes = 0;
  const cli = { capture: async () => ({ code: 0, stdout: JSON.stringify({ plugins: [{ id: 'openclaw-snowluma', enabled: true }] }) }), interactive: async () => 0, input: async () => { writes++; return { code: 1, error: 'token' }; } };
  await assert.rejects(runWizard(ui, cli, async () => true), error => !error.message.includes('token') && /配置检查失败/.test(error.message));
  assert.equal(writes, 1);
});

test('wizard can install the latest video skill when requested', async () => {
  const confirmations = [false, true, false, true, true, false];
  const answers = ['ws://localhost:3001', '123456', ''];
  const ui = { print() {}, confirm: async () => confirmations.shift(), askValid: async (_label, _default, parse) => parse(answers.shift()), secret: async () => 'token' };
  const invoked = [];
  const cli = {
    capture: async args => ({ code: 0, stdout: args[1] === 'list' ? JSON.stringify({ plugins: [{ id: 'openclaw-snowluma', enabled: true }] }) : JSON.stringify({ plugin: { status: 'loaded' } }) }),
    interactive: async args => { invoked.push(args); return 0; },
    input: async () => ({ code: 0 })
  };
  await runWizard(ui, cli, async () => true);
  assert.deepEqual(invoked, [['fatfish', 'install-video-skill']]);
});
