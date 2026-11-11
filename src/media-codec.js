import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function audioFormat(buffer) {
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (buffer.subarray(0, 3).toString() === 'ID3' || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (buffer.subarray(4, 8).toString() === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (buffer.subarray(0, 4).toString() === 'fLaC') return { mime: 'audio/flac', ext: 'flac' };
  if (buffer.subarray(0, 4).toString() === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  return null;
}

export async function normalizeAudio(buffer, { ffmpeg = 'ffmpeg', maxSeconds = 120, signal } = {}) {
  if (signal?.aborted) throw new Error('音频处理已取消。');
  const root = await mkdtemp(join(tmpdir(), 'fatfish-audio-'));
  const input = join(root, 'input.audio'), output = join(root, 'output.wav');
  try {
    await writeFile(input, buffer, { mode: 0o600, flag: 'wx' });
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input, '-t', String(maxSeconds + 1), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-fs', String((maxSeconds + 1) * 32000 + 1024), output], { stdio: 'ignore', windowsHide: true });
      let aborted = false, timedOut = false;
      const abort = () => { aborted = true; child.kill(); };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.once('error', () => { cleanup(); reject(new Error('无法启动 FFmpeg 音频转换器。')); });
      child.once('close', code => { cleanup(); code === 0 && !aborted && !timedOut ? resolve() : reject(new Error(aborted ? '音频处理已取消。' : timedOut ? '音频转换超时。' : '当前语音编码无法解码；QQ SILK 可能需要通道提供转换，请改发 WAV 或 MP3。')); });
    });
    const result = await readFile(output);
    if (!audioFormat(result) || result.length > maxSeconds * 32000 + 1024) throw new Error('语音时长超过上限，请缩短后重试。');
    return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}
