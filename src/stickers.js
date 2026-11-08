import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';

const LIMIT = 5 * 1024 * 1024;
function fileType(data) {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'gif';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片。');
}
function validEntry(item) {
  return item && /^[0-9a-f]{64}$/.test(item.id) && ['png', 'jpg', 'gif', 'webp'].includes(item.ext) &&
    typeof item.description === 'string' && item.description.length > 0 && item.description.length <= 160 &&
    Array.isArray(item.tags) && item.tags.length <= 10 && item.tags.every(t => typeof t === 'string' && t.length > 0 && t.length <= 24);
}
function terms(query) {
  const chunks = query.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? [];
  return [...new Set(chunks.flatMap(s => /[\u3400-\u9fff]/.test(s) && s.length > 2 ? [s, ...Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))] : [s]).filter(s => s.length >= 2))];
}
export function createStickerStore(stateDir, maxEntries = 64) {
  if (!isAbsolute(stateDir) || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500) throw new Error('表情库配置无效。');
  const dir = join(stateDir, 'fatfish', 'stickers');
  const files = join(dir, 'files');
  const index = join(dir, 'index.json');
  let pending = Promise.resolve();
  async function list() {
    let text;
    try { text = await readFile(index, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('表情库索引过大。');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length > 500 || !parsed.every(validEntry) || new Set(parsed.map(x => x.id)).size !== parsed.length) throw new Error('表情库索引无效。');
    return parsed;
  }
  async function save(items) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `index-${randomUUID()}.tmp`);
    try { await writeFile(tmp, JSON.stringify(items, null, 2), { flag: 'wx', mode: 0o600 }); await rename(tmp, index); }
    finally { await unlink(tmp).catch(() => {}); }
  }
  function serialize(fn) { const task = pending.then(fn); pending = task.catch(() => {}); return task; }
  function add(path, description, tags = []) {
    return serialize(async () => {
      description = typeof description === 'string' ? description.trim() : '';
      if (!description || description.length > 160 || /[\r\n\0]/.test(description)) throw new Error('表情描述须为 1 至 160 字符，且不能换行。');
      if (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== 'string' || !t.trim() || t.trim().length > 24 || /[\r\n\0]/.test(t))) throw new Error('表情标签最多 10 个，每个不超过 24 字符。');
      tags = [...new Set(tags.map(t => t.trim()))];
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0 || info.size > LIMIT) throw new Error('表情文件必须小于 5 MB。');
      const data = await readFile(path);
      if (!data.length || data.length > LIMIT) throw new Error('表情文件必须小于 5 MB。');
      const ext = fileType(data), id = createHash('sha256').update(data).digest('hex');
      const items = await list();
      const existing = items.find(x => x.id === id);
      if (existing) return { item: existing, added: false };
      if (items.length >= maxEntries) throw new Error('表情库已满，请先删除或调整上限。');
      await mkdir(files, { recursive: true, mode: 0o700 });
      const target = join(files, `${id}.${ext}`);
      try { await writeFile(target, data, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const item = { id, ext, description, tags, addedAt: new Date().toISOString() };
      await save([...items, item]);
      return { item, added: true };
    });
  }
  function remove(id) {
    return serialize(async () => {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('表情 ID 无效，请使用完整 ID。');
      const items = await list(), item = items.find(x => x.id === id);
      if (!item) return false;
      await save(items.filter(x => x.id !== id));
      await unlink(join(files, `${item.id}.${item.ext}`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      return true;
    });
  }
  async function get(id) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('表情 ID 无效。');
    const item = (await list()).find(x => x.id === id);
    if (!item) return null;
    const filePath = join(files, `${item.id}.${item.ext}`);
    const info = await stat(filePath).catch(() => null);
    return info?.isFile() && info.size > 0 && info.size <= LIMIT ? { ...item, filePath } : null;
  }
  async function search(query, limit = 12) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('请输入 1 至 200 字符的表情场景或标签。');
    const tokens = terms(query);
    if (!tokens.length) return [];
    const items = await list();
    return items.map(item => {
      const description = item.description.toLowerCase(), tags = item.tags.map(x => x.toLowerCase());
      const score = tokens.reduce((n, term) => n + (tags.some(t => t === term) ? 5 : tags.some(t => t.includes(term)) ? 3 : 0) + (description.includes(term) ? 1 : 0), 0);
      return { item, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).slice(0, Math.min(Math.max(limit, 1), 30)).map(x => x.item);
  }
  return { add, remove, list, get, search, filesDir: files };
}

export function createStickerCooldown(intervalSeconds = 60, now = Date.now) {
  const last = new Map();
  return key => {
    if (typeof key !== 'string' || !key) throw new Error('无法确定当前会话，不能发送表情。');
    const timestamp = now();
    const previous = last.get(key);
    if (previous !== undefined && timestamp - previous < intervalSeconds * 1000) return false;
    if (last.size >= 2000) for (const [k, t] of last) if (timestamp - t >= intervalSeconds * 1000) last.delete(k);
    if (last.size >= 2000 && !last.has(key)) return false;
    last.set(key, timestamp); return true;
  };
}
