// src/index.js 依赖 OpenClaw 提供的 plugin-sdk，而本仓库只在 peerDependencies 里
// 声明该依赖，干净克隆下并没有 node_modules。为了让插件装配逻辑能被真正执行并断言，
// 这里用 Node 的模块解析钩子把 openclaw/plugin-sdk/* 换成本地最小桩实现。
//
// 边界说明：本文件验证的是“给定桩 SDK 行为时的装配逻辑”，不等于真实 OpenClaw
// 运行时行为已被验证。真实通道、真实消息路由仍需在 SnowLuma + QQ 环境联调。
import { registerHooks } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const sdkStub = [
  'export function definePluginEntry(entry) { return entry; }',
  "export async function readRemoteMediaBuffer() { throw new Error('桩实现不应被调用'); }"
].join('\n');
const sdkUrl = `data:text/javascript;base64,${Buffer.from(sdkStub).toString('base64')}`;

// registerHooks 从 Node 22.15 起提供；低版本直接跳过而不是伪装通过。
const canStub = typeof registerHooks === 'function';
const skipSdk = canStub ? false : '需要 Node 22.15+ 提供 module.registerHooks';

if (canStub) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'openclaw/plugin-sdk/plugin-entry' || specifier === 'openclaw/plugin-sdk/media-runtime') {
        return { url: sdkUrl, shortCircuit: true, format: 'module' };
      }
      return nextResolve(specifier, context);
    }
  });
}

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('openclaw.plugin.json', root), 'utf8'));
// 动态导入必须放在 registerHooks 之后，静态 import 会被提升到钩子注册之前执行。
const plugin = canStub ? (await import('../src/index.js')).default : null;

// 模拟 OpenClaw 传给插件的注册接口，只实现本插件实际用到的部分。
function createHarness({ config = {}, stateDir, registrationMode = 'full' }) {
  const captured = { cli: [], commands: [], tools: [], hooks: [], mediaProviders: [] };
  const api = {
    registrationMode,
    pluginConfig: config,
    logger: { warn() {}, error() {}, info() {} },
    runtime: { state: { resolveStateDir: () => stateDir } },
    registerCli(fn, opts) { captured.cli.push({ fn, opts }); },
    registerCommand(command) { captured.commands.push(command); },
    registerTool(tool, meta = {}) { captured.tools.push({ tool, meta }); },
    registerMediaUnderstandingProvider(provider) { captured.mediaProviders.push(provider); },
    on(event, handler) { captured.hooks.push({ event, handler }); }
  };
  plugin.register(api);
  return captured;
}

// 每个用例使用独立的临时状态目录，避免多个用例共享权限、表情或黑名单文件。
async function setup(t, config = {}, options = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fatfish-index-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return { ...createHarness({ config, stateDir, ...options }), stateDir };
}

const adminCtx = { messageChannel: 'snowluma', requesterSenderId: '10001', sessionKey: 'session-1' };

// 工具既可能以工厂函数注册（需要会话上下文），也可能直接以对象注册，这里统一展开。
function toolMap(captured, ctx = adminCtx) {
  const map = new Map();
  for (const { tool, meta } of captured.tools) {
    map.set(meta.name, { descriptor: typeof tool === 'function' ? tool(ctx) : tool, meta });
  }
  return map;
}

test('插件契约声明的工具与运行时注册的工具完全一致', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  const names = captured.tools.map(entry => entry.meta.name).sort();
  assert.deepEqual(names, [...manifest.contracts.tools].sort());
  assert.equal(new Set(names).size, names.length, '同一个工具不能被重复注册');
});

test('工具参数声明封闭，且必填项都在 properties 中有定义', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  const tools = toolMap(captured);
  for (const [name, { descriptor, meta }] of tools) {
    assert.equal(meta.optional, true, `${name} 应通过 optional 标记为按需启用`);
    assert.equal(descriptor.parameters?.type, 'object', `${name} 的参数必须是 object`);
    assert.equal(descriptor.parameters?.additionalProperties, false, `${name} 的参数必须封闭`);
    for (const key of descriptor.parameters?.required ?? []) {
      assert.ok(descriptor.parameters.properties?.[key], `${name} 的必填参数 ${key} 缺少类型定义`);
    }
  }
});

test('注册 fish 命令与 fatfish CLI，命令要求通道鉴权', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  assert.equal(captured.commands.length, 1);
  const [command] = captured.commands;
  assert.equal(command.name, 'fish');
  assert.equal(command.requireAuth, true, 'QQ 指令必须要求鉴权，不能依赖通道默认值');
  assert.equal(command.acceptsArgs, true);
  assert.equal(captured.cli.length, 1);
  assert.equal(captured.cli[0].opts?.descriptors?.[0]?.name, 'fatfish');
});

test('挂载黑名单和人格两个钩子', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  assert.deepEqual(captured.hooks.map(entry => entry.event).sort(), ['before_dispatch', 'before_prompt_build']);
});

test('cli-metadata 模式只注册 CLI，不注册工具和钩子', { skip: skipSdk }, async t => {
  const captured = await setup(t, {}, { registrationMode: 'cli-metadata' });
  assert.equal(captured.cli.length, 1);
  assert.equal(captured.commands.length, 0);
  assert.equal(captured.tools.length, 0);
  assert.equal(captured.hooks.length, 0, '元数据模式不应产生任何运行时副作用');
});

test('未通过通道授权的用户只能看到提示，拿不到帮助文本', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  const reply = await captured.commands[0].handler({
    channel: 'snowluma', senderId: '10001', from: 'private:10001', args: '', isAuthorizedSender: false
  });
  assert.match(reply.text, /未通过通道授权/);
  assert.doesNotMatch(reply.text, /允许普通用户/, '未授权时不能泄露权限状态');
});

test('非管理员执行管理指令被拒绝', { skip: skipSdk }, async t => {
  const captured = await setup(t, { admins: ['10001'] });
  const reply = await captured.commands[0].handler({
    channel: 'snowluma', senderId: '20002', from: 'private:20002', args: 'permissions', isAuthorizedSender: true
  });
  assert.match(reply.text, /仅限已配置并通过通道授权的 QQ 管理员/);
});

test('管理员切换权限会真实落盘', { skip: skipSdk }, async t => {
  const { commands, stateDir } = await setup(t, { admins: ['10001'] });
  const reply = await commands[0].handler({
    channel: 'snowluma', senderId: '10001', from: 'private:10001', args: 'allow image on', isAuthorizedSender: true
  });
  assert.match(reply.text, /已允许普通用户使用生图/);
  const saved = JSON.parse(await readFile(join(stateDir, 'fatfish', 'permissions.json'), 'utf8'));
  assert.equal(saved.image, true);
  assert.equal(saved.video, false, '只应改动被请求的那一项权限');
});

test('帮助文本覆盖 docs/commands.md 表格里的全部指令', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  const doc = await readFile(new URL('docs/commands.md', root), 'utf8');
  // 只取表格行，避免把正文里“尚未实现”的 /fish status 当成已发布指令。
  const documented = doc.split(/\r?\n/)
    .filter(line => line.startsWith('|'))
    .flatMap(line => [...line.matchAll(/`([^`]+)`/g)].map(match => match[1]))
    .filter(command => command.startsWith('/fish'))
    .map(command => command.replace(/\\\|/g, '|'));
  assert.ok(documented.length > 0, '文档表格里应当能找到指令');
  const reply = await captured.commands[0].handler({
    channel: 'snowluma', senderId: '10001', from: 'private:10001', args: '', isAuthorizedSender: true
  });
  for (const command of documented) {
    assert.ok(reply.text.includes(command), `帮助文本缺少文档中的指令：${command}`);
  }
});

test('TTS 未启用时拒绝合成', { skip: skipSdk }, async t => {
  const captured = await setup(t);
  const tts = toolMap(captured).get('fatfish_tts');
  await assert.rejects(tts.descriptor.execute('call-1', { text: '你好' }), /TTS 未启用/);
});

test('TTS 启用后仍要求可验证身份和语音权限', { skip: skipSdk }, async t => {
  const captured = await setup(t, { tts: { enabled: true }, admins: ['10001'] });

  // 通道没有传可信发送者时不能放行，否则任何人都能反复触发计费接口。
  const anonymous = toolMap(captured, { messageChannel: 'snowluma', sessionKey: 's0' }).get('fatfish_tts');
  await assert.rejects(anonymous.descriptor.execute('call-1', { text: '你好' }), /没有使用语音合成的权限/);

  // 非管理员默认没有 tts 权限，需要管理员显式开启。
  const stranger = toolMap(captured, { messageChannel: 'snowluma', requesterSenderId: '20002', sessionKey: 's2' }).get('fatfish_tts');
  await assert.rejects(stranger.descriptor.execute('call-2', { text: '你好' }), /没有使用语音合成的权限/);
});

test('管理员可以单独开启语音合成权限', { skip: skipSdk }, async t => {
  const { commands, stateDir } = await setup(t, { admins: ['10001'] });
  const reply = await commands[0].handler({
    channel: 'snowluma', senderId: '10001', from: 'private:10001', args: 'allow tts on', isAuthorizedSender: true
  });
  assert.match(reply.text, /语音合成/);
  const saved = JSON.parse(await readFile(join(stateDir, 'fatfish', 'permissions.json'), 'utf8'));
  assert.equal(saved.tts, true);
  assert.equal(saved.image, false, '只应改动被请求的那一项权限');
});

test('生成工具在身份不可验证或跨通道时 fail-closed', { skip: skipSdk }, async t => {
  const captured = await setup(t, { image: { enabled: true, provider: 'agnes' }, admins: ['10001'] });

  // 身份缺失：通道没有传可信发送者，必须直接拒绝而不是放行。
  const anonymous = toolMap(captured, { messageChannel: 'snowluma', sessionKey: 's0' }).get('fatfish_generate_image');
  await assert.rejects(anonymous.descriptor.execute('call-1', { prompt: '一条鱼' }), /没有使用此功能的权限/);

  // 跨通道：非 snowluma 来源不能复用 QQ 权限。
  const other = toolMap(captured, { messageChannel: 'telegram', requesterSenderId: '10001', sessionKey: 's2' })
    .get('fatfish_generate_image');
  await assert.rejects(other.descriptor.execute('call-2', { prompt: '一条鱼' }), /没有使用此功能的权限/);
});

test('表情工具默认拒绝，授权管理员可以查询空库', { skip: skipSdk }, async t => {
  const captured = await setup(t, { stickers: { enabled: true }, admins: ['10001'] });

  const disabled = await setup(t, { stickers: { enabled: false }, admins: ['10001'] });
  await assert.rejects(
    toolMap(disabled).get('fatfish_sticker_search').descriptor.execute('call-1', { query: '开心' }),
    /表情包功能未启用/
  );

  const stranger = toolMap(captured, { messageChannel: 'snowluma', requesterSenderId: '20002', sessionKey: 's3' })
    .get('fatfish_sticker_search');
  await assert.rejects(stranger.descriptor.execute('call-2', { query: '开心' }), /没有使用表情包的权限/);

  const result = await toolMap(captured).get('fatfish_sticker_search').descriptor.execute('call-3', { query: '开心' });
  assert.match(result.content[0].text, /没有找到匹配的表情包/);
});

test('看视频在未启用时拒绝，启用但未安装引擎时给出明确指引', { skip: skipSdk }, async t => {
  const disabled = await setup(t, { admins: ['10001'] });
  await assert.rejects(
    toolMap(disabled).get('fatfish_watch_video').descriptor.execute('call-1', { url: 'https://example.com/a.mp4', question: '这是什么' }),
    /看视频功能未启用/
  );

  const enabled = await setup(t, { admins: ['10001'], watchVideo: { enabled: true } });
  await assert.rejects(
    toolMap(enabled).get('fatfish_watch_video').descriptor.execute('call-2', { url: 'https://example.com/a.mp4', question: '这是什么' }),
    /尚未安装看视频引擎/
  );
});

test('媒体解析默认关闭，开启后仍要求身份与站点校验', { skip: skipSdk }, async t => {
  const off = await setup(t);
  await assert.rejects(
    toolMap(off).get('fatfish_parse_link').descriptor.execute('call-1', { url: 'https://www.bilibili.com/video/BV1xx' }),
    /媒体解析未启用/
  );

  const on = await setup(t, { parse: { enabled: true }, admins: ['10001'] });
  const anonymous = toolMap(on, { messageChannel: 'snowluma', sessionKey: 's0' }).get('fatfish_parse_link');
  await assert.rejects(
    anonymous.descriptor.execute('call-2', { url: 'https://www.bilibili.com/video/BV1xx' }),
    /没有使用媒体解析的权限/
  );

  // 即使是管理员，也不能把任意地址交给 yt-dlp。
  await assert.rejects(
    toolMap(on).get('fatfish_parse_link').descriptor.execute('call-3', { url: 'https://example.com/x' }),
    /暂不支持该站点/
  );
});

test('管理员可以开关媒体解析并持久化', { skip: skipSdk }, async t => {
  const { commands, stateDir } = await setup(t, { admins: ['10001'] });
  const base = { channel: 'snowluma', senderId: '10001', from: 'private:10001', isAuthorizedSender: true };
  assert.match((await commands[0].handler({ ...base, args: 'parse' })).text, /媒体解析：已关闭/);
  assert.match((await commands[0].handler({ ...base, args: 'parse on' })).text, /已启用/);
  const saved = JSON.parse(await readFile(join(stateDir, 'fatfish', 'parse.json'), 'utf8'));
  assert.equal(saved.enabled, true);
  assert.match((await commands[0].handler({ ...base, args: 'parse status' })).text, /已启用/);
  assert.match((await commands[0].handler({ ...base, args: 'parse off' })).text, /已关闭/);
});

test('STT 供应商仅在启用时注册，缺少密钥时返回 null', { skip: skipSdk }, async t => {
  const off = await setup(t);
  assert.equal(off.mediaProviders.length, 0, '未启用 STT 时不应注册媒体理解供应商');

  const on = await setup(t, { stt: { enabled: true } });
  assert.equal(on.mediaProviders.length, 1);
  const [provider] = on.mediaProviders;
  assert.equal(provider.id, 'fatfish-siliconflow');
  assert.deepEqual(provider.capabilities, ['audio']);

  const previous = process.env.SILICONFLOW_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = previous;
  });
  delete process.env.SILICONFLOW_API_KEY;
  assert.equal(provider.resolveAuth(), null, '没有密钥时必须返回 null 而不是抛错或返回空密钥');
  process.env.SILICONFLOW_API_KEY = 'test-key';
  assert.deepEqual(provider.resolveAuth(), { kind: 'api-key', apiKey: 'test-key', source: 'SILICONFLOW_API_KEY' });
});
