import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { synthesize } from './tts.js';
import { canUse, createPolicyStore, makeAdminCommand } from './permissions.js';
import { generateComfy } from './comfy.js';
import { createPersonaStore, makePersonaHook } from './persona.js';

export default definePluginEntry({
  id: 'fatfish',
  name: '大肥鱼 QQ 伙伴',
  description: '可选的语音等能力，适用于 OpenClaw 机器人',
  register(api) {
    const config = api.pluginConfig?.tts ?? {};
    const admins = api.pluginConfig?.admins ?? [];
    const stateDir = api.runtime.state.resolveStateDir();
    const store = createPolicyStore(stateDir);
    const personaStore = createPersonaStore(stateDir, api.pluginConfig?.persona);
    api.on('before_prompt_build', makePersonaHook(personaStore, api.logger));
    let generating = false;
    const generate = async (kind, prompt) => {
      if (generating) throw new Error('已有生成任务正在运行，请稍后再试。');
      generating = true;
      try { return await generateComfy(prompt, { ...api.pluginConfig?.[kind], kind }); }
      finally { generating = false; }
    };
    api.registerCommand(makeAdminCommand({ admins, store, generate, personaStore }));
    for (const kind of ['image', 'video']) {
      const name = `fatfish_generate_${kind}`;
      api.registerTool((ctx) => ({
        name,
        label: kind === 'image' ? '大肥鱼生图' : '大肥鱼生视频',
        description: `按照用户明确意图使用管理员配置的本机 ComfyUI 工作流生成${kind === 'image' ? '图片' : '视频'}。仅当用户获授权时才会运行。`,
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
    api.registerTool({
      name: 'fatfish_tts',
      label: '大肥鱼语音合成',
      description: '使用已配置的 Edge TTS 把用户请求的文字合成为语音文件。完成后通过支持的消息工具发送音频；不能保证所有 QQ 通道支持语音消息。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } },
        required: ['text']
      },
      async execute(_id, params) {
        if (config.enabled !== true) throw new Error('TTS 未启用。请查看 docs/tts.md 完成配置。');
        const result = await synthesize(params.text, config);
        return {
          content: [{ type: 'text', text: `语音已生成：${result.filePath}。如当前通道支持，请通过消息工具发送此音频；发送失败时告知用户。` }],
          details: result
        };
      }
    }, { name: 'fatfish_tts', optional: true, promptGuidance: '用户明确要求语音时，可使用 fatfish_tts 生成音频。仅在支持的当前会话中发送结果，不要声称已经发送，除非发送成功。' });
  }
});
