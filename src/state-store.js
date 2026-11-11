import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const writers = new Map();

// 小规模运行状态的原子更新；同一进程的不同模块实例也共享写队列。
export function jsonStore(path, initial, validate = value => value) {
  const file = resolve(path);
  async function read() {
    try {
      const raw = await readFile(file, 'utf8');
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('状态文件过大。');
      return validate(JSON.parse(raw));
    } catch (error) {
      if (error.code === 'ENOENT') return validate(structuredClone(initial));
      throw new Error('运行状态文件无法读取，请检查权限或恢复备份。');
    }
  }
  function update(change) {
    const work = (writers.get(file) ?? Promise.resolve()).then(async () => {
      const value = await read();
      const result = await change(value);
      validate(value);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(() => {}); }
      return result;
    });
    const pending = work.catch(() => {});
    writers.set(file, pending);
    pending.finally(() => { if (writers.get(file) === pending) writers.delete(file); });
    return work;
  }
  return { read, update };
}
