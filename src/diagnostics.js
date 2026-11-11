import { spawn } from 'node:child_process';
import { CAPABILITIES } from './capabilities.js';
import { resolveVideoSkill } from './video-skill-install.js';

async function hasCommand(command, args = ['--version']) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function diagnose({ config = {}, pluginConfig = {}, stateDir, env = process.env, commandExists = hasCommand }) {
  const checks = [];
  const add = (name, status, note) => checks.push({ name, status, note });
  add('管理员', pluginConfig.admins?.length ? 'configured' : 'needs-setup', pluginConfig.admins?.length ? '已配置身份；请在 QQ 用 /fish whoami 核对' : '尚未设置；官方机器人请先用 /fish whoami 获取 openid');
  const model = config.agents?.defaults?.model;
  add('聊天模型', (typeof model === 'string' && model) || model?.primary ? 'configured' : 'needs-setup', '这里只检查默认模型配置；连通性与真实回复尚未验证');
  const tools = config.tools ?? {};
  const allowed = [...(tools.alsoAllow ?? []), ...(tools.allow ?? [])];
  for (const feature of CAPABILITIES) {
    const options = pluginConfig[feature.configKey] ?? {};
    if (options.enabled !== true) { add(feature.label, 'disabled', `未启用；教程 docs/${feature.guide}`); continue; }
    const visible = allowed.some(name => name === 'fatfish' || name === 'group:plugins' || name === '*') || feature.tools.every(name => allowed.includes(name));
    const denied = (tools.deny ?? []).some(name => name === '*' || name === 'fatfish' || feature.tools.includes(name));
    add(`${feature.label}工具`, visible && !denied ? 'configured' : 'needs-setup', visible && !denied ? '全局工具设置已开放；还需检查 agent 级规则与 /fish allow 权限' : '检查 tools.alsoAllow 与 tools.deny；自然语言调用可能不可用');
    const key = ['image', 'video'].includes(feature.id) && options.provider === 'agnes' ? 'AGNES_API_KEY' : feature.id === 'tts' && options.provider === 'mimo' ? 'MIMO_API_KEY' : undefined;
    if (key) add(`${feature.label}凭据`, env[key] ? 'configured' : 'needs-setup', env[key] ? '环境变量已设置，未验证额度或接口' : `缺少 ${key}；请在 Gateway 的运行环境中设置`);
  }
  if (pluginConfig.stt?.enabled) add('STT 凭据', env.SILICONFLOW_API_KEY ? 'configured' : 'needs-setup', env.SILICONFLOW_API_KEY ? '已设置，未验证真实转写' : '缺少 SILICONFLOW_API_KEY');
  if (pluginConfig.persona?.enabled) {
    const hooks = config.plugins?.entries?.fatfish?.hooks;
    add('人格钩子', hooks?.allowConversationAccess === true && hooks?.allowPromptInjection !== false && hooks?.allowPromptModification !== false ? 'configured' : 'needs-setup', '需允许聊天访问；提示修改开关新旧版本名称不同，不能显式设为 false；实际效果需聊天确认');
  }
  if (pluginConfig.status?.enabled !== false && pluginConfig.status?.captureUsage !== false) {
    add('面板用量钩子', config.plugins?.entries?.fatfish?.hooks?.allowConversationAccess === true ? 'configured' : 'needs-setup', '需允许聊天访问；只记录数字用量和模型元数据，缺少时面板数据可能不可用');
  }
  const dependencies = [];
  if (pluginConfig.stt?.enabled) dependencies.push(['语音附件 FFmpeg', pluginConfig.attachments?.ffmpegPath || 'ffmpeg', ['-version']]);
  if (pluginConfig.parse?.enabled) dependencies.push(['yt-dlp', pluginConfig.parse.ytdlpPath || 'yt-dlp'], ['ffmpeg', 'ffmpeg', ['-version']]);
  if (pluginConfig.watchVideo?.enabled) {
    const python = pluginConfig.watchVideo.python || 'python';
    dependencies.push(['看视频 Python / Pillow', python, ['-c', 'import sys; assert sys.version_info >= (3, 10); import PIL']]);
    const ffmpeg = await commandExists('ffmpeg', ['-version']) || await commandExists(python, ['-c', 'import os, imageio_ffmpeg; assert os.path.isfile(imageio_ffmpeg.get_ffmpeg_exe())']);
    add('看视频 FFmpeg', ffmpeg ? 'configured' : 'needs-setup', ffmpeg ? '系统或 imageio-ffmpeg 可用；ffprobe 缺失时引擎可降级' : '请安装系统 FFmpeg，或在看视频的 Python 环境安装 imageio-ffmpeg');
    try { await resolveVideoSkill(stateDir); add('看视频引擎', 'configured', '已安装；更新用 install-video-skill，回退用 rollback-video-skill'); }
    catch { add('看视频引擎', 'needs-setup', '尚未安装或文件不完整；运行 openclaw fatfish install-video-skill'); }
  }
  if (pluginConfig.tts?.enabled && (pluginConfig.tts.provider ?? 'edge') === 'edge') dependencies.push(['Edge TTS Python', pluginConfig.tts.python || 'python', ['-c', 'import edge_tts']]);
  const unique = [...new Map(dependencies.map(item => [item[0], item])).values()];
  const found = await Promise.all(unique.map(async ([name, command, args]) => [name, await commandExists(command, args)]));
  for (const [name, exists] of found) add(name, exists ? 'configured' : 'needs-setup', exists ? '本机可启动' : '未找到或无法启动，请安装并检查路径');
  add('QQ 收发与媒体回执', 'unverified', '请重启 Gateway 后测试 /fish help、文字聊天及一次已配置的媒体功能');
  const labels = { configured: '已配置', disabled: '未启用', 'needs-setup': '需处理', unverified: '未验证' };
  return { ok: !checks.some(check => check.status === 'needs-setup'), checks, text: ['🐟 大肥鱼配置诊断（不调用模型、不显示密钥）', ...checks.map(check => `[${labels[check.status]}] ${check.name}：${check.note}`)].join('\n') };
}
