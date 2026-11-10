// 按会话维度的冷却表。表情包和语音合成共用同一份实现，
// 避免两处各自维护导致冷却键不一致、互相绕过。
export function createCooldown(intervalSeconds = 60, now = Date.now) {
  const last = new Map();
  return key => {
    if (typeof key !== 'string' || !key) throw new Error('无法确定当前会话，不能执行此操作。');
    const timestamp = now();
    const previous = last.get(key);
    if (previous !== undefined && timestamp - previous < intervalSeconds * 1000) return false;
    if (last.size >= 2000) for (const [k, t] of last) if (timestamp - t >= intervalSeconds * 1000) last.delete(k);
    if (last.size >= 2000 && !last.has(key)) return false;
    last.set(key, timestamp);
    return true;
  };
}
