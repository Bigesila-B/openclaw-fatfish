import { generateComfy } from '../comfy.js';
import { synthesize } from '../tts.js';
import { generateAgnes } from './agnes.js';
import { synthesizeMimo } from './mimo.js';

// Providers are selected only from administrator configuration, never model arguments.
const generators = {
  comfy: (kind, prompt, config) => generateComfy(prompt, { ...config, kind }),
  agnes: (kind, prompt, config) => generateAgnes(kind, prompt, config)
};
const speech = { edge: synthesize, mimo: synthesizeMimo };

export function generateMedia(kind, prompt, config = {}) {
  const name = config.provider ?? 'comfy';
  if (!Object.hasOwn(generators, name)) throw new Error('未知的图片或视频供应商。');
  const provider = generators[name];
  return provider(kind, prompt, config);
}

export function synthesizeSpeech(text, config = {}) {
  const name = config.provider ?? 'edge';
  if (!Object.hasOwn(speech, name)) throw new Error('未知的语音供应商。');
  const provider = speech[name];
  return provider(text, config);
}
