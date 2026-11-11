// 功能标识、权限名称、工具和教程集中声明，供管理命令与诊断共用。
export const CAPABILITIES = Object.freeze([
  { id: 'image', label: '生图', configKey: 'image', tools: ['fatfish_generate_image'], guide: 'cloud-providers.md' },
  { id: 'video', label: '生视频', configKey: 'video', tools: ['fatfish_generate_video'], guide: 'cloud-providers.md' },
  { id: 'watch', label: '看视频', configKey: 'watchVideo', tools: ['fatfish_watch_video'], guide: 'video-watch.md' },
  { id: 'sticker', label: '表情包', configKey: 'stickers', tools: ['fatfish_sticker_search', 'fatfish_sticker_select'], guide: 'stickers.md' },
  { id: 'tts', label: '语音合成', configKey: 'tts', tools: ['fatfish_tts'], guide: 'tts.md' },
  { id: 'parse', label: '媒体解析', configKey: 'parse', tools: ['fatfish_parse_link'], guide: 'media-parse.md' }
]);

export const capabilityIds = CAPABILITIES.map(item => item.id);
