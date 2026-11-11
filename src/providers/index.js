import { generateComfy } from '../comfy.js';
import { synthesize } from '../tts.js';
import { generateAgnes, pollAgnesVideo } from './agnes.js';
import { synthesizeMimo } from './mimo.js';

// Providers are selected only from administrator configuration, never model arguments.
const generators = {
  comfy: (kind, prompt, config) => generateComfy(prompt, { ...config, kind }),
  agnes: (kind, prompt, config, controls) => generateAgnes(kind, prompt, config, fetch, controls)
};
const speech = { edge: synthesize, mimo: synthesizeMimo };

export function generateMedia(kind, prompt, config = {}, controls = {}) {
  const name = config.provider ?? 'comfy';
  if (!Object.hasOwn(generators, name)) throw new Error('未知的图片或视频供应商。');
  const provider = generators[name];
  return provider(kind, prompt, config, controls);
}

export function resumeMedia(kind, taskId, config, controls) {
  if (kind === 'video' && config.provider === 'agnes') return pollAgnesVideo(taskId, config, fetch, controls);
  throw new Error('当前供应商不支持恢复查询；不会自动重新提交生成请求。');
}

export function synthesizeSpeech(text, config = {}) {
  const name = config.provider ?? 'edge';
  if (!Object.hasOwn(speech, name)) throw new Error('未知的语音供应商。');
  const provider = speech[name];
  return provider(text, config);
}
