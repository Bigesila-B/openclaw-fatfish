import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnostics.js';

test('配置诊断不调用供应商且不输出密钥，区分配置与真实验证', async () => {
  const report = await diagnose({
    config: { agents: { defaults: { model: { primary: 'provider/model' } } }, tools: { alsoAllow: ['fatfish'] } },
    pluginConfig: { admins: ['123456'], image: { enabled: true, provider: 'agnes' }, parse: { enabled: true } },
    env: { AGNES_API_KEY: 'secret-do-not-display' }, commandExists: async name => name !== 'yt-dlp'
  });
  assert.equal(report.ok, false);
  assert.match(report.text, /yt-dlp.*未找到/);
  assert.match(report.text, /未验证.*QQ 收发/);
  assert.doesNotMatch(report.text, /secret-do-not-display/);
  assert.equal(report.checks.find(item => item.name === '生图凭据').status, 'configured');
});

test('诊断发现缺少工具开放、人格权限和供应商凭据', async () => {
  const report = await diagnose({ pluginConfig: { tts: { enabled: true, provider: 'mimo' }, persona: { enabled: true } }, env: {} });
  for (const name of ['管理员', '聊天模型', '语音合成工具', '语音合成凭据', '人格钩子']) assert.equal(report.checks.find(item => item.name === name).status, 'needs-setup');
});

test('人格提示修改权限兼容新旧宿主，默认允许，显式关闭时诊断提示', async () => {
  for (const extra of [{}, { allowPromptInjection: false }, { allowPromptModification: false }]) {
    const report = await diagnose({ pluginConfig: { persona: { enabled: true } }, config: { plugins: { entries: { fatfish: { hooks: { allowConversationAccess: true, ...extra } } } } } });
    assert.equal(report.checks.find(check => check.name === '人格钩子').status, Object.keys(extra).length ? 'needs-setup' : 'configured');
  }
});

test('看视频诊断使用配置的 Python，接受内置 FFmpeg，不把可选 ffprobe 当作必需', async () => {
  const calls = [];
  const report = await diagnose({ pluginConfig: { watchVideo: { enabled: true, python: '/custom/python' } }, commandExists: async (command, args) => { calls.push([command, args]); return command !== 'ffmpeg'; } });
  assert.equal(report.checks.find(check => check.name === '看视频 FFmpeg').status, 'configured');
  assert.ok(calls.some(([command, args]) => command === '/custom/python' && args.includes('-c')));
  assert.ok(calls.every(([command]) => command !== 'ffprobe'));
});
