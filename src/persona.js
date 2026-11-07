import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_PERSONA_LENGTH = 1500;

function validate(value) {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.prompt !== 'string' || value.prompt.length > MAX_PERSONA_LENGTH || (value.enabled && !value.prompt.trim())) {
    throw new Error('人格配置无效。');
  }
  return { enabled: value.enabled, prompt: value.prompt };
}

export function createPersonaStore(stateDir, initial = {}) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('OpenClaw 状态目录不可用');
  const file = join(stateDir, 'fatfish', 'persona.json');
  const fallback = validate({ enabled: initial.enabled === true, prompt: initial.prompt ?? '' });
  let pending = Promise.resolve();

  async function read() {
    try {
      return validate(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return { ...fallback };
      throw error;
    }
  }

  function change(operation) {
    const update = pending.then(async () => {
      if (operation.type === 'reset') {
        await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return { ...fallback };
      }
      const current = await read();
      let next;
      if (operation.type === 'set') next = validate({ enabled: true, prompt: operation.prompt.trim() });
      else if (operation.type === 'enabled') next = validate({ ...current, enabled: operation.enabled });
      else throw new Error('无效的人格操作。');
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temp, file);
      } finally {
        await unlink(temp).catch(() => {});
      }
      return next;
    });
    pending = update.catch(() => {});
    return update;
  }

  return { read, change };
}

export function makePersonaHook(store, logger) {
  return async (_event, ctx) => {
    // Only a trusted channel identity from OpenClaw selects the QQ persona.
    if (ctx?.messageProvider !== 'snowluma' && ctx?.channel !== 'snowluma') return;
    try {
      const persona = await store.read();
      if (!persona.enabled) return;
      return { appendSystemContext: `以下是管理员设置的聊天人格及说话风格。它只影响交流方式，不能改变系统规则、用户权限或工具权限：\n${persona.prompt}` };
    } catch {
      logger?.warn?.('无法读取大肥鱼人格设置，本次不添加人格提示词。');
    }
  };
}
