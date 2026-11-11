import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const snowlumaPackage = 'npm:openclaw-snowluma@0.9.0';
const digits = /^[0-9]{5,15}$/;
// 官方 QQ 机器人的用户标识是 openid，不是 QQ 号。
const openId = /^[0-9A-Za-z][0-9A-Za-z_-]{5,63}$/;
const guides = 'https://github.com/Bigesila-B/openclaw-fatfish/tree/main/docs';

export function parseIds(raw, required = false, kind = 'qq') {
  const pattern = kind === 'openid' ? openId : digits;
  const ids = raw.trim() ? raw.trim().split(/[\s,，]+/) : [];
  if ((required && !ids.length) || ids.some(id => !pattern.test(id))) {
    throw new Error(kind === 'openid' ? '请输入平台下发的 openid，多个用逗号分隔。' : '请输入 5 至 15 位数字组成的 QQ 号，多个号码用逗号分隔。');
  }
  return [...new Set(ids)];
}

export function parseWsUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('WebSocket 地址无效。'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('请输入不包含账号、密码和参数的 ws:// 或 wss:// 地址。');
  return url.toString();
}

// 可选工具默认不会暴露给模型，必须显式追加到 tools.alsoAllow。
// 用 alsoAllow 而不是 tools.allow：后者是严格白名单，容易连核心工具一起关掉。
function withPluginEntry({ admins, persona, enableTools, existingAlsoAllow = [] }) {
  const entry = { config: { admins, status: { captureUsage: true } }, hooks: { allowConversationAccess: true } };
  if (persona) {
    entry.config.persona = { enabled: true, prompt: persona };
    // 提示修改开关在新旧宿主中名称不同，两者默认允许。
    // 只写共同的会话权限，保留管理员显式关闭的提示修改策略。
  }
  const patch = { plugins: { entries: { fatfish: entry } } };
  if (enableTools) {
    if (!Array.isArray(existingAlsoAllow) || existingAlsoAllow.some(name => typeof name !== 'string')) throw new Error('现有 tools.alsoAllow 格式无效，请先修复配置。');
    patch.tools = { alsoAllow: [...new Set([...existingAlsoAllow, 'fatfish'])] };
  }
  return patch;
}

export function buildPatch({ wsUrl, token, admins, groups, persona, enableTools = false, existingAlsoAllow = [] }) {
  const channel = { enabled: true, wsUrl, accessToken: token };
  // 只有显式填写群号时才收窄来源；留空表示不做通道级限制，
  // 任何人都能私聊或在群里触发（真正的功能权限仍由 fatfish 的 admins 和 /fish allow 控制）。
  // config patch 用 null 删除字段；省略会保留旧名单，与“留空不限制”不一致。
  channel.allowFrom = groups.length ? [...admins.map(id => `private:${id}`), ...groups.map(id => `group:${id}`)] : null;
  return { channels: { snowluma: channel }, ...withPluginEntry({ admins, persona, enableTools, existingAlsoAllow }) };
}

export function buildQQBotPatch({ appId, clientSecret, admins, persona, enableTools = false, existingAlsoAllow = [] }) {
  // allowFrom 留空表示不限制来源：官方机器人默认只有创建者能私聊。
  return { channels: { qqbot: { enabled: true, appId, clientSecret } }, ...withPluginEntry({ admins, persona, enableTools, existingAlsoAllow }) };
}

async function readAlsoAllow(cli, enableTools) {
  if (!enableTools) return [];
  const result = await cli.capture(['config', 'get', 'tools', '--json']);
  if (result.code !== 0) {
    if (/Config path not found: tools(?:\.|\s|$)/.test(result.error ?? '')) return [];
    throw new Error('无法读取现有工具设置，未应用 QQ 配置；请先运行 openclaw config validate。');
  }
  try {
    const tools = JSON.parse(result.stdout);
    const values = tools?.alsoAllow ?? [];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error();
    return values;
  } catch { throw new Error('无法解析现有工具设置，未应用 QQ 配置。'); }
}

async function showDiagnostics(ui, cli) {
  const result = await cli.capture(['fatfish', 'doctor']);
  if (result.stdout?.trim()) ui.print(result.stdout.trim());
  if (result.code !== 0) ui.print('有项目需要处理；稍后运行 openclaw fatfish doctor 查看。此检查不会调用计费模型。');
}

export async function runWizard(ui, cli, probe = probeTcp, options = {}) {
  const channel = options.channel ?? 'snowluma';
  if (channel === 'qqbot') return runQQBotWizard(ui, cli, options);
  if (channel !== 'snowluma') throw new Error('不支持的接入方式。');
  return runSnowlumaWizard(ui, cli, probe, options);
}

async function runSnowlumaWizard(ui, cli, probe, { enableTools = false }) {
  ui.print('\n🐟 大肥鱼 QQ 配置向导（实验版）');
  ui.print('接入方式：SnowLuma OneBot。本向导需要已安装的 OpenClaw 和可扫码登录的 SnowLuma。配置前可随时按 Ctrl+C 退出。');
  ui.print('已验证的 OpenClaw 版本：2026.6.35；其他版本的兼容性需要自行验证。');

  if (await ui.confirm('\n第 1 步：现在使用 OpenClaw 官方向导配置聊天模型？', true)) {
    const result = await cli.interactive(['configure', '--section', 'model']);
    if (result !== 0) throw new Error('模型向导未成功完成，请先解决后重新运行。');
  } else ui.print('已跳过模型配置。请确保已配置可用模型；本向导不会验证模型回复。');

  ui.print('\n第 2 步：启动 SnowLuma 并用手机 QQ 扫码登录。');
  ui.print('安装与登录教程：https://snowluma.github.io/zh/docs/guide/quickstart');
  ui.print('还需要在 SnowLuma 开启 OneBot WebSocket 并记下访问令牌。');
  if (!await ui.confirm('已经完成安装、登录和 OneBot 配置？', false)) {
    ui.print('请先按教程完成后重新运行本向导。当前未修改 QQ 配置。');
    return { completed: false, reason: 'snowluma-not-ready' };
  }

  const wsUrl = await ui.askValid('SnowLuma WebSocket 地址', 'ws://127.0.0.1:3001/', parseWsUrl);
  const host = new URL(wsUrl).hostname;
  if (new URL(wsUrl).protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(host)) ui.print('提示：远程 ws:// 连接不加密，请在可信网络中使用，或配置安全的 wss://。');
  ui.print('令牌将隐藏输入，但会作为 SnowLuma 配置保存在 OpenClaw 配置文件中。');
  let token = await ui.secret('SnowLuma access token（不会显示）: ');
  if (!token && !await ui.confirm('令牌为空，仅在你的 SnowLuma 确实没有设置令牌时继续。继续？', false)) return { completed: false, reason: 'missing-token' };
  if (token.length > 4096 || /[\r\n\u0000]/.test(token)) throw new Error('令牌格式无效。');
  const admins = await ui.askValid('管理员 QQ 号，多个用逗号分隔', '', value => parseIds(value, true));
  const groups = await ui.askValid('允许机器人回复的群号，多个用逗号分隔；留空表示不限制来源（任何人都能聊）', '', value => parseIds(value));

  ui.print('\n第 3 步：检测 SnowLuma WebSocket 端口……');
  if (!await probe(wsUrl)) {
    ui.print('无法连接这个地址。请检查 SnowLuma 是否运行、OneBot 端口以及网络命名空间。');
    return { completed: false, reason: 'port-unreachable' };
  }
  ui.print('端口可连接；这不代表令牌正确或 QQ 已在线，稍后仍需真实消息测试。');

  ui.print('\n第 4 步：检查 SnowLuma 通道插件（可能需要一些时间）。');
  const listed = await cli.capture(['plugins', 'list', '--json']);
  if (listed.code !== 0) throw new Error('无法读取 OpenClaw 插件列表，请先运行 openclaw plugins list 排查。');
  let plugin;
  try { plugin = JSON.parse(listed.stdout).plugins.find(item => item.id === 'openclaw-snowluma'); }
  catch { throw new Error('无法解析 OpenClaw 插件列表。'); }
  if (!plugin) {
    ui.print('需要安装第三方通道插件 openclaw-snowluma 0.9.0：https://github.com/t871631092/openclaw-snowluma');
    if (!await ui.confirm('安装这个插件？', true)) return { completed: false, reason: 'channel-not-installed' };
    const code = await cli.interactive(['plugins', 'install', snowlumaPackage, '--force']);
    if (code !== 0) throw new Error('通道插件安装失败；请检查网络和 OpenClaw 插件安装日志。');
  } else if (!plugin.enabled) {
    ui.print('通道插件已安装但未启用。');
    if (!await ui.confirm('启用它？', true)) return { completed: false, reason: 'channel-disabled' };
  }
  if (!plugin?.enabled) {
    const code = await cli.interactive(['plugins', 'enable', 'openclaw-snowluma']);
    if (code !== 0) throw new Error('无法启用 SnowLuma 通道插件。');
  }

  let persona = '';
  ui.print('\n第 5 步：可选的人格和功能。');
  if (await ui.confirm('现在配置机器人说话风格？', false)) {
    ui.print('启用人格需要允许本插件使用聊天提示钩子；请先确认信任该插件。');
    persona = await ui.askValid('人格描述（最多 1500 字符）', '', value => {
      const text = value.trim();
      if (!text || text.length > 1500) throw new Error('人格描述不能为空且最多 1500 个字符。');
      return text;
    });
  }
  ui.print(`Agnes 聊天、生图和视频，MiMo TTS，以及硅基流动 STT 可以之后按教程配置：${guides}/cloud-providers.md。`);
  ui.print(`可选看视频功能配置：${guides}/video-watch.md；表情包功能配置：${guides}/stickers.md。`);
  if (await ui.confirm('现在从 GitHub 下载最新版看视频引擎？（需要 Git）', false)) {
    const code = await cli.interactive(['fatfish', 'install-video-skill']);
    if (code !== 0) ui.print('看视频引擎安装未完成；QQ 配置可继续，稍后可运行 openclaw fatfish install-video-skill 重试。');
  }

  const existingAlsoAllow = await readAlsoAllow(cli, enableTools);
  const patch = buildPatch({ wsUrl, token, admins, groups, persona, enableTools, existingAlsoAllow });
  ui.print('\n第 6 步：准备写入配置：');
  ui.print(`- QQ 通道地址：${wsUrl}`);
  ui.print(`- 管理员：${admins.join('、')}`);
  ui.print(`- 来源限制：${groups.length ? `仅管理员私聊与群 ${groups.join('、')}` : '不限制（任何人都能私聊，群里 @ 可触发）'}`);
  ui.print(`- 写入 SnowLuma 令牌与管理员列表；${groups.length ? '替换来源名单' : '清除旧的来源名单，恢复不限制来源'}。`);
  ui.print(`- 给模型注册大肥鱼工具（tools.alsoAllow）：${enableTools ? '是' : '否；不开的话 AI 无法主动调用生图、解析等能力'}`);
  ui.print(`- 人格：${persona ? '启用；若宿主显式禁止提示修改，需按其版本配置开启' : '不改动现有人格配置'}`);
  ui.print('- 允许聊天访问钩子用于面板用量统计；插件只保存模型标识和数字，不保存聊天正文。');
  if (persona) ui.print('- 如果之前在 QQ 中设置过人格，该设置仍优先；可用 /fish persona reset 恢复配置文件中的人格。');
  ui.print('- 其他通道、模型与功能配置保留。已有同名 QQ 通道字段会被本次输入覆盖。');
  if (!await ui.confirm('应用这些设置？', true)) return { completed: false, reason: 'cancelled' };

  const serialized = JSON.stringify(patch);
  const preview = await cli.input(['config', 'patch', '--stdin', '--dry-run'], serialized, token);
  if (preview.code !== 0) throw new Error('配置检查失败，未写入 QQ 设置；请检查插件安装和 OpenClaw 配置后重试。');
  const applied = await cli.input(['config', 'patch', '--stdin'], serialized, token);
  token = '';
  if (applied.code !== 0) throw new Error('写入配置失败；请检查 OpenClaw 配置和 Gateway 状态后重试。');
  ui.print('配置已写入。');
  const validation = await cli.capture(['config', 'validate']);
  if (validation.code !== 0) throw new Error('配置已写入，但验证失败；请运行 openclaw config validate 检查。');
  ui.print('检查 SnowLuma 通道插件是否能加载……');
  const checked = await cli.capture(['plugins', 'inspect', 'openclaw-snowluma', '--runtime', '--json']);
  try {
    if (checked.code !== 0 || JSON.parse(checked.stdout).plugin.status !== 'loaded') throw new Error();
  } catch { throw new Error('配置已写入，但 SnowLuma 通道插件未能加载；请运行 openclaw plugins inspect openclaw-snowluma --runtime 检查。'); }
  await showDiagnostics(ui, cli);
  ui.print('\n第 7 步：启动或重启 OpenClaw Gateway，然后从管理员 QQ 私聊机器人发送测试消息。');
  ui.print('配置已写入；本向导没有验证 Gateway、QQ 在线状态或机器人是否成功回复。');
  if (await ui.confirm('如果 Gateway 尚未运行，是否现在前台启动？', false)) {
    ui.print('Gateway 运行期间请保持终端打开，并用管理员 QQ 私聊测试；按 Ctrl+C 结束前台服务。');
    const code = await cli.interactive(['gateway', 'run']);
    if (code !== 0) throw new Error('Gateway 未能正常运行；请检查终端中的启动日志。');
  } else ui.print('请按自己的部署方式启动或重启 Gateway，前台启动命令：openclaw gateway run');
  return { completed: true };
}

// 官方 QQ 机器人：不需要 SnowLuma，也不需要扫码登录本机进程，
// 但需要去开放平台创建机器人并拿到 AppID / AppSecret。
async function runQQBotWizard(ui, cli, { enableTools = false }) {
  ui.print('\n🐟 大肥鱼 QQ 官方机器人配置向导（实验版）');
  ui.print('接入方式：QQ 开放平台官方机器人（OpenClaw 内建 qqbot 通道）。配置前可随时按 Ctrl+C 退出。');

  if (await ui.confirm('\n第 1 步：现在使用 OpenClaw 官方向导配置聊天模型？', true)) {
    const result = await cli.interactive(['configure', '--section', 'model']);
    if (result !== 0) throw new Error('模型向导未成功完成，请先解决后重新运行。');
  } else ui.print('已跳过模型配置。请确保已配置可用模型；本向导不会验证模型回复。');

  ui.print('\n第 2 步：在 QQ 开放平台创建机器人。');
  ui.print('打开 https://q.qq.com/qqbot/openclaw/login.html ，用手机 QQ 扫码登录后点“创建机器人”。');
  ui.print('AppSecret 不会明文保存，离开页面就只能重新生成，请先复制保存。');
  if (!await ui.confirm('已经拿到 AppID 和 AppSecret？', false)) {
    ui.print('请先完成创建并保存凭据后重新运行本向导。当前未修改 QQ 配置。');
    return { completed: false, reason: 'qqbot-not-ready' };
  }

  const appId = await ui.askValid('AppID（纯数字）', '', value => {
    const text = value.trim();
    if (!/^[0-9]{5,20}$/.test(text)) throw new Error('AppID 应该是纯数字，请检查是否复制完整。');
    return text;
  });
  const clientSecret = await ui.secret('AppSecret（不会显示）: ');
  if (!clientSecret) return { completed: false, reason: 'missing-secret' };
  if (clientSecret.length > 512 || /[\r\n\u0000]/.test(clientSecret)) throw new Error('AppSecret 格式无效。');

  // 官方机器人只能拿到 openid，拿不到 QQ 号，所以管理员这一项允许留空。
  ui.print('\n第 3 步：管理员标识。官方机器人不下发 QQ 号，管理员用 openid 识别。');
  ui.print('如果还没拿到 openid，可以先留空；配置完成并重启后，私聊机器人发送 /fish whoami 查询。');
  const admins = await ui.askValid('管理员 openid，多个用逗号分隔（可留空）', '', value => parseIds(value, false, 'openid'));

  ui.print('\n第 4 步：检查 qqbot 通道。');
  const listed = await cli.capture(['plugins', 'list', '--json']);
  if (listed.code === 0) {
    try {
      const names = JSON.parse(listed.stdout).plugins.map(item => item.id);
      if (names.includes('qqbot') || names.includes('openclaw-qqbot')) ui.print('已检测到 qqbot 通道插件。');
      else ui.print('未检测到独立的 qqbot 插件；较新的 OpenClaw 已内建 qqbot 通道，可直接继续。');
    } catch { ui.print('无法解析插件列表，跳过通道检查。'); }
  } else ui.print('无法读取插件列表，跳过通道检查。');

  let persona = '';
  ui.print('\n第 5 步：可选的人格和功能。');
  if (await ui.confirm('现在配置机器人说话风格？', false)) {
    ui.print('启用人格需要允许本插件使用聊天提示钩子；请先确认信任该插件。');
    persona = await ui.askValid('人格描述（最多 1500 字符）', '', value => {
      const text = value.trim();
      if (!text || text.length > 1500) throw new Error('人格描述不能为空且最多 1500 个字符。');
      return text;
    });
  }
  ui.print(`其余功能按教程配置：${guides}`);
  if (!enableTools) ui.print('注意：未给模型注册大肥鱼工具，AI 将无法主动调用生图、生视频、解析等能力，只能用 /fish 指令。');

  const existingAlsoAllow = await readAlsoAllow(cli, enableTools);
  const patch = buildQQBotPatch({ appId, clientSecret, admins, persona, enableTools, existingAlsoAllow });
  ui.print('\n第 6 步：准备写入配置：');
  ui.print(`- 官方机器人 AppID：${appId}`);
  ui.print(`- 管理员：${admins.length ? admins.join('、') : '未设置（稍后用 /fish whoami 查询后补上）'}`);
  ui.print(`- 给模型注册大肥鱼工具（tools.alsoAllow）：${enableTools ? '是' : '否'}`);
  ui.print(`- 人格：${persona ? '启用；若宿主显式禁止提示修改，需按其版本配置开启' : '不改动现有人格配置'}`);
  ui.print('- 允许聊天访问钩子用于面板用量统计；插件只保存模型标识和数字，不保存聊天正文。');
  ui.print('- 其他通道、模型与功能配置保留。已有同名 channel 字段会被本次输入覆盖。');
  if (!await ui.confirm('应用这些设置？', true)) return { completed: false, reason: 'cancelled' };

  const serialized = JSON.stringify(patch);
  const preview = await cli.input(['config', 'patch', '--stdin', '--dry-run'], serialized, clientSecret);
  if (preview.code !== 0) throw new Error('配置检查失败，未写入 QQ 设置；请检查 OpenClaw 配置后重试。');
  const applied = await cli.input(['config', 'patch', '--stdin'], serialized, clientSecret);
  if (applied.code !== 0) throw new Error('写入配置失败；请检查 OpenClaw 配置和 Gateway 状态后重试。');
  ui.print('配置已写入。');
  const validation = await cli.capture(['config', 'validate']);
  if (validation.code !== 0) throw new Error('配置已写入，但验证失败；请运行 openclaw config validate 检查。');
  await showDiagnostics(ui, cli);

  ui.print('\n第 7 步：重启 OpenClaw Gateway，然后私聊机器人发送 /fish whoami。');
  ui.print('配置已写入；本向导没有验证 Gateway、QQ 在线状态或机器人是否成功回复。');
  if (await ui.confirm('如果 Gateway 尚未运行，是否现在前台启动？', false)) {
    ui.print('Gateway 运行期间请保持终端打开；按 Ctrl+C 结束前台服务。');
    const code = await cli.interactive(['gateway', 'run']);
    if (code !== 0) throw new Error('Gateway 未能正常运行；请检查终端中的启动日志。');
  } else ui.print('请按自己的部署方式启动或重启 Gateway，前台启动命令：openclaw gateway run');
  if (!admins.length) ui.print('拿到 openid 后，把它写进 plugins.entries.fatfish.config.admins，否则 /fish 的管理指令不可用。');
  return { completed: true };
}

function probeTcp(address) {
  const url = new URL(address);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise(resolve => {
    const socket = connect({ host, port: Number(url.port || (url.protocol === 'wss:' ? 443 : 80)) });
    let done = false;
    const finish = result => { if (done) return; done = true; socket.destroy(); resolve(result); };
    socket.setTimeout(4000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function createUi() {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  output.isTTY = true;
  output.columns = process.stdout.columns;
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return {
    print: text => process.stdout.write(`${text}\n`),
    async askValid(label, fallback, parse) {
      while (true) {
        const answer = await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `);
        try { return parse(answer || fallback); } catch (error) { process.stdout.write(`${error.message}\n`); }
      }
    },
    async confirm(question, fallback) {
      while (true) {
        const answer = (await rl.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
        if (!answer) return fallback;
        if (['y', 'yes', '是'].includes(answer)) return true;
        if (['n', 'no', '否'].includes(answer)) return false;
        process.stdout.write('请输入 y 或 n。\n');
      }
    },
    async secret(label) {
      process.stdout.write(label);
      muted = true;
      try { return await rl.question(''); }
      finally { muted = false; process.stdout.write('\n'); }
    },
    pause: () => rl.pause(),
    resume: () => rl.resume(),
    close: () => rl.close()
  };
}

function createCli(ui) {
  const entry = process.argv[1];
  if (!entry || !/openclaw(?:\.mjs|\.cjs|\.js)?$/i.test(entry)) throw new Error('无法确定 OpenClaw 命令入口；请从 openclaw fatfish setup 启动向导。');
  function run(args, input, inherit, secret = '') {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], { stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '', stderr = '', exceeded = false;
      const timer = inherit ? undefined : setTimeout(() => { exceeded = true; child.kill(); }, 120000);
      const append = (current, chunk) => {
        const combined = current + chunk;
        if (combined.length > 4 * 1024 * 1024) { exceeded = true; child.kill(); return combined.slice(0, 4 * 1024 * 1024); }
        return combined;
      };
      if (!inherit) {
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
        child.stdin.on('error', () => {});
        child.stdin.end(input ?? '');
      }
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        const redact = value => secret ? value.split(secret).join('[已隐藏]') : value;
        resolve({ code: exceeded ? 1 : code ?? 1, stdout: redact(stdout), error: exceeded ? '操作超时或输出过大。' : redact(stderr).slice(-2000) });
      });
    });
  }
  return {
    async interactive(args) { ui.pause(); try { return (await run(args, undefined, true)).code; } finally { ui.resume(); } },
    capture: args => run(args, undefined, false),
    input: (args, input, secret) => run(args, input, false, secret)
  };
}

export async function startWizard() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('配置向导需要交互式终端。');
  const ui = createUi();
  try {
    ui.print('\n🐟 大肥鱼 QQ 配置向导');
    ui.print('1 = QQ 开放平台官方机器人（推荐：不用扫码挂 SnowLuma，OpenClaw 内建 qqbot 通道）');
    ui.print('2 = SnowLuma OneBot（第三方通道，需要本机跑 SnowLuma 并扫码登录）');
    const channel = await ui.askValid('选择接入方式', '1', parseChannelChoice);
    // 可选工具默认不会暴露给模型；这里默认开启，否则 AI 用不了生图、解析等能力。
    const enableTools = await ui.confirm('是否把大肥鱼的功能注册给模型（写入 tools.alsoAllow）？', true);
    return await runWizard(ui, createCli(ui), probeTcp, { channel, enableTools });
  }
  finally { ui.close(); }
}

export function parseChannelChoice(raw) {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '1' || value === 'qqbot' || value === '官方') return 'qqbot';
  if (value === '2' || value === 'snowluma' || value === 'onebot') return 'snowluma';
  throw new Error('请输入 1（官方机器人）或 2（SnowLuma）。');
}
