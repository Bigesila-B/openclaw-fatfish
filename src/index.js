import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { synthesize } from './tts.js';

export default definePluginEntry({
  id: 'fatfish',
  name: '大肥鱼 QQ 伙伴',
  description: '可选的语音等能力，适用于 OpenClaw 机器人',
  register(api) {
    const config = api.pluginConfig?.tts ?? {};
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
