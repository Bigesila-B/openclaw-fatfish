import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { readRemoteMediaBuffer } from 'openclaw/plugin-sdk/media-runtime';
import { canUse, createPolicyStore, makeAdminCommand } from './permissions.js';
import { generateMedia, synthesizeSpeech } from './providers/index.js';
import { transcribeSilicon } from './providers/siliconflow.js';
import { createPersonaStore, makePersonaHook } from './persona.js';
import { createBlacklistStore, makeBlacklistHook } from './blacklist.js';
import { buildVideoContext } from './video-watch.js';
import { installVideoSkill, resolveVideoSkill } from './video-skill-install.js';

export default definePluginEntry({
  id: 'fatfish',
  name: '大肥鱼 QQ 伙伴',
  description: '可选的语音等能力，适用于 OpenClaw 机器人',
  register(api) {
    if (['full', 'discovery', 'cli-metadata'].includes(api.registrationMode ?? 'full')) {
      api.registerCli(({ program }) => {
        const command = program.command('fatfish').description('大肥鱼 QQ 机器人配置');
        command.command('setup').description('交互式配置 QQ 接入').action(async () => {
          try { const { startWizard } = await import('./wizard.js'); const result = await startWizard(); if (!result.completed) process.exitCode = 1; }
          catch (error) { console.error(`配置向导未完成：${error.message}`); process.exitCode = 1; }
        });
        command.command('install-video-skill').description('下载或更新最新版看视频引擎').action(async () => {
          try {
            const installed = await installVideoSkill(api.runtime.state.resolveStateDir());
            console.log(`看视频引擎已安装：${installed.commit}。配置教程：docs/video-watch.md`);
          } catch (error) { console.error(`看视频引擎安装失败：${error.message}`); process.exitCode = 1; }
        });
      }, { descriptors: [{ name: 'fatfish', description: '大肥鱼 QQ 机器人配置', hasSubcommands: true }] });
      if (api.registrationMode === 'cli-metadata') return;
    }
    const config = api.pluginConfig?.tts ?? {};
    const admins = api.pluginConfig?.admins ?? [];
    const stateDir = api.runtime.state.resolveStateDir();
    const store = createPolicyStore(stateDir);
    const blacklistStore = createBlacklistStore(stateDir, api.pluginConfig?.blacklist);
    const personaStore = createPersonaStore(stateDir, api.pluginConfig?.persona);
    if (api.pluginConfig?.stt?.enabled === true) {
      api.registerMediaUnderstandingProvider({
        id: 'fatfish-siliconflow', capabilities: ['audio'],
        defaultModels: { audio: api.pluginConfig.stt.model ?? 'TeleAI/TeleSpeechASR' },
        resolveAuth: () => process.env.SILICONFLOW_API_KEY ? { kind: 'api-key', apiKey: process.env.SILICONFLOW_API_KEY, source: 'SILICONFLOW_API_KEY' } : null,
        transcribeAudio: transcribeSilicon
      });
    }
    api.on('before_dispatch', makeBlacklistHook(blacklistStore, api.logger));
    api.on('before_prompt_build', makePersonaHook(personaStore, api.logger));
    let generating = false;
    const generate = async (kind, prompt) => {
      if (generating) throw new Error('已有生成任务正在运行，请稍后再试。');
      generating = true;
      try {
        const options = api.pluginConfig?.[kind] ?? {};
        return await generateMedia(kind, prompt, options);
      }
      finally { generating = false; }
    };
    api.registerCommand(makeAdminCommand({ admins, store, generate, personaStore, blacklistStore }));
    for (const kind of ['image', 'video']) {
      const name = `fatfish_generate_${kind}`;
      api.registerTool((ctx) => ({
        name,
        label: kind === 'image' ? '大肥鱼生图' : '大肥鱼生视频',
        description: `按照用户明确意图使用管理员配置的服务生成${kind === 'image' ? '图片' : '视频'}。仅当用户获授权时才会运行。`,
        parameters: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['prompt'] },
        async execute(_id, params) {
          const identity = { channel: ctx.messageChannel, senderId: ctx.requesterSenderId };
          if (!canUse(identity, admins, await store.read(), kind)) throw new Error('当前 QQ 用户没有使用此功能的权限，或身份不可验证。');
          const result = await generate(kind, params.prompt);
          if (!canUse(identity, admins, await store.read(), kind)) throw new Error('生成期间权限发生变化，无法返回结果。');
          return { content: [{ type: 'text', text: `生成完成：${result.filePath}。请通过当前会话的消息工具发送文件；只有发送成功后才表示已发送。` }], details: result };
        }
      }), { name, optional: true, promptGuidance: `用户明确请求生成${kind === 'image' ? '图片' : '视频'}时可调用 ${name}；权限由工具检查。` });
    }
    let watching = false;
    api.registerTool(ctx => ({
      name: 'fatfish_watch_video',
      label: '大肥鱼看视频',
      description: '分析用户明确提供的 HTTPS 视频文件直链：采样画面并可转写音频。仅接收视频文件直链，不能处理普通网页或服务器本地路径。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { url: { type: 'string', minLength: 1, maxLength: 4096 }, question: { type: 'string', minLength: 1, maxLength: 1000 } },
        required: ['url', 'question']
      },
      async execute(_id, params) {
        const identity = { channel: ctx.messageChannel, senderId: ctx.requesterSenderId };
        if (!canUse(identity, admins, await store.read(), 'watch')) throw new Error('当前 QQ 用户没有使用看视频功能的权限，或身份不可验证。');
        if (api.pluginConfig?.watchVideo?.enabled !== true) throw new Error('看视频功能未启用，请查看配置教程。');
        if (watching) throw new Error('已有视频正在分析，请稍后再试。');
        watching = true;
        try {
          const engine = await resolveVideoSkill(stateDir);
          const result = await buildVideoContext({ ...params, config: api.pluginConfig?.watchVideo, commonStt: api.pluginConfig?.stt, skillDir: engine.path, fetchMedia: readRemoteMediaBuffer });
          if (!canUse(identity, admins, await store.read(), 'watch')) throw new Error('分析期间权限发生变化，无法返回结果。');
          return result;
        } finally { watching = false; }
      }
    }), { name: 'fatfish_watch_video', optional: true, promptGuidance: '用户明确要求分析并提供 HTTPS 视频文件直链时可调用 fatfish_watch_video。只根据返回的抽样图像和转写回答；QQ 视频附件和网页链接不等同于直链。' });
    api.registerTool({
      name: 'fatfish_tts',
      label: '大肥鱼语音合成',
      description: '使用管理员配置的语音服务把用户请求的文字合成为语音文件。完成后通过支持的消息工具发送音频；不能保证所有 QQ 通道支持语音消息。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } },
        required: ['text']
      },
      async execute(_id, params) {
        if (config.enabled !== true) throw new Error('TTS 未启用。请查看 docs/tts.md 完成配置。');
        const result = await synthesizeSpeech(params.text, config);
        return {
          content: [{ type: 'text', text: `语音已生成：${result.filePath}。如当前通道支持，请通过消息工具发送此音频；发送失败时告知用户。` }],
          details: result
        };
      }
    }, { name: 'fatfish_tts', optional: true, promptGuidance: '用户明确要求语音时，可使用 fatfish_tts 生成音频。仅在支持的当前会话中发送结果，不要声称已经发送，除非发送成功。' });
  }
});
