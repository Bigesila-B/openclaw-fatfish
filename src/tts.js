import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const helper = join(dirname(fileURLToPath(import.meta.url)), '..', 'python', 'edge_tts_helper.py');
const retentionMs = 24 * 60 * 60 * 1000;

export async function synthesize(text, config = {}, run = runHelper) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('文本须为 1 到 1000 个字符。');
  const voice = config.voice ?? 'zh-CN-XiaoxiaoNeural';
  if (typeof voice !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(voice)) throw new Error('音色名称无效。');
  const python = config.python ?? 'python';
  if (typeof python !== 'string' || !python.trim()) throw new Error('Python 路径无效。');
  const directory = join(tmpdir(), 'openclaw-fatfish');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await cleanOldFiles(directory);
  const filePath = join(directory, `${randomUUID()}.mp3`);
  try {
    await run(python, helper, { text, voice, output: filePath });
    const result = await stat(filePath);
    if (!result.isFile() || result.size === 0) throw new Error('语音文件为空。');
    return { filePath, mimeType: 'audio/mpeg' };
  } catch (error) {
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

async function cleanOldFiles(directory) {
  const now = Date.now();
  for (const name of await readdir(directory)) {
    if (!/^[0-9a-f-]{36}\.mp3$/i.test(name)) continue;
    const path = join(directory, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs > retentionMs) await unlink(path).catch(() => {});
  }
}

function runHelper(python, script, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let errors = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(new Error(`无法启动 Python：${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`语音合成失败：${errors.trim() || `退出码 ${code}`}。请查看 docs/tts.md。`));
    });
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdin.end(JSON.stringify(payload));
  });
}
