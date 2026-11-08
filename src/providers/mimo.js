import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { credential, jsonRequest, save, decodeBase64 } from './shared.js';

const mimo = 'https://api.xiaomimimo.com';

export async function synthesizeMimo(text, options = {}, fetchFn = fetch) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('文本须为 1 到 1000 个字符。');
  let voice = options.voice || '冰糖';
  let model = options.model || 'mimo-v2.5-tts';
  if (options.cloneSamplePath) {
    const ext = extname(options.cloneSamplePath).toLowerCase();
    const mime = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[ext];
    if (!mime) throw new Error('克隆样本须为 WAV 或 MP3。');
    const info = await stat(options.cloneSamplePath);
    if (!info.isFile() || !info.size || info.size > 10 * 1024 * 1024) throw new Error('音色样本必须是 10 MB 以内的文件。');
    voice = `data:${mime};base64,${(await readFile(options.cloneSamplePath)).toString('base64')}`;
    model = options.cloneModel || 'mimo-v2.5-tts-voiceclone';
  }
  const result = await jsonRequest(`${mimo}/v1/chat/completions`, credential('MIMO_API_KEY'), { model, messages: [{ role: 'assistant', content: text }], audio: { format: 'wav', voice } }, 120000, fetchFn);
  const data = decodeBase64(result.choices?.[0]?.message?.audio?.data);
  if (data.subarray(0, 4).toString() !== 'RIFF' || data.subarray(8, 12).toString() !== 'WAVE') throw new Error('MiMo 返回的音频格式无效。');
  return { filePath: await save(data, 'wav'), mimeType: 'audio/wav' };
}
