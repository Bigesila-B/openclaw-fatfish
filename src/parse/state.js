import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 媒体解析的运行时开关：/fish parse on|off 会写在这里，重启后仍然有效。
// 配置文件里的 parse.enabled 只是初始默认值。
export function createParseState(stateDir, initial = false) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw 状态目录不可用');
  const file = join(stateDir, 'fatfish', 'parse.json');

  async function read() {
    let raw;
    try { raw = await readFile(file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return initial === true;
      throw error;
    }
    const value = JSON.parse(raw);
    if (!value || typeof value.enabled !== 'boolean') throw new Error('媒体解析开关文件格式错误。');
    return value.enabled;
  }

  async function set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('媒体解析开关值无效。');
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ enabled }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return enabled;
  }

  return { read, set };
}
