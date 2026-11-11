import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const font = fileURLToPath(new URL('../../assets/panel/FatfishPanelSans.ttf', import.meta.url));
const escape = value => String(value ?? '不可用').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const short = (value, max = 48) => {
  let result = '', width = 0;
  for (const char of String(value ?? '不可用')) {
    width += char.codePointAt(0) > 255 ? 1.8 : 1;
    if (width > max) return `${result}…`;
    result += char;
  }
  return result;
};
export const formatBytes = value => value == null ? '不可用' : `${(value / 1024 ** 3).toFixed(1)} GB`;
export const formatTokens = value => value == null ? '不可用' : new Intl.NumberFormat('en-US').format(Math.round(value));
const percent = value => value == null ? '不可用' : `${value.toFixed(1)}%`;
const usageText = value => value ? `${formatTokens(value.total)} tokens · 输入 ${formatTokens(value.input)} / 输出 ${formatTokens(value.output)}` : '不可用（尚无观测数据）';

export function statusText(data) {
  if (data.public) return ['🐟 大肥鱼状态简报', ...data.features.map(feature => `${feature.label}：${feature.status}`), '详细模型、用量与主机信息请由管理员私聊查询。'].join('\n');
  const context = data.context;
  return [
    `🐟 大肥鱼状态 · ${data.version}`,
    `模型：${data.model ?? '不可用'}${data.modelSource ? `（${data.modelSource}）` : ''}`,
    `上下文：${formatTokens(context.used)} / ${formatTokens(context.limit)}${context.used != null && context.limit > 0 ? ` · ${(context.used / context.limit * 100).toFixed(1)}%` : ''}`,
    `今日：${usageText(data.usage.today)}`, `本月：${usageText(data.usage.month)}`,
    `统计时区：${data.usage.timeZone}；用量不等同于供应商账单`,
    `统计范围：${data.usage.scope}`,
    `CPU：${percent(data.host.cpuPercent)}`,
    `内存：${formatBytes(data.host.memory?.used)} / ${formatBytes(data.host.memory?.total)}`,
    `磁盘：${formatBytes(data.host.disk?.used)} / ${formatBytes(data.host.disk?.total)}`,
    ...(data.host.gpus?.length ? data.host.gpus.map(gpu => `GPU ${gpu.name}：${percent(gpu.percent)}，显存 ${formatBytes(gpu.used)} / ${formatBytes(gpu.total)}`) : ['GPU：不可用或采集已关闭']),
    `运行范围：${data.host.scope}`,
    `任务：等待 ${data.tasks?.queued ?? '不可用'} / 运行 ${data.tasks?.running ?? '不可用'} / 待查询 ${data.tasks?.waiting ?? '不可用'}`,
    ...data.features.map(feature => `${feature.label}：${feature.status}${feature.lastTest ? `；最近调用 ${feature.lastTest}` : ''}`),
    ...(data.extra ?? []).map(item => `${item.id}：${item.value}`),
    `更新：${data.generatedAt}`,
    '连接：已收到当前 QQ 查询；QQ 连接健康未主动检测。',
    '用量为插件观测值，可能不完整；未读取的数据不填零。'
  ].join('\n');
}

export function statusSvg(data, { theme = 'dark' } = {}) {
  const dark = theme !== 'light', bg = dark ? '#0a1220' : '#edf3f8', card = dark ? '#121f32' : '#ffffff', fg = dark ? '#f0f6ff' : '#17283d', muted = dark ? '#99adc8' : '#536b86', accent = '#39cdb2';
  const lines = data.public ? statusText(data).split('\n').slice(1) : null;
  const featureHeight = Math.ceil(data.features.length / 2) * 70;
  const height = data.public ? 220 + lines.length * 54 : 1000 + featureHeight;
  const text = (x, y, value, size = 25, color = fg, weight = 400) => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}">${escape(value)}</text>`;
  const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${card}"/>`;
  const meter = (x, y, value, width = 400) => `<rect x="${x}" y="${y}" width="${width}" height="8" rx="4" fill="${dark ? '#25364e' : '#dce7f1'}"/>${Number.isFinite(value) ? `<rect x="${x}" y="${y}" width="${Math.max(0, Math.min(100, value)) / 100 * width}" height="8" rx="4" fill="${value > 90 ? '#f5a76b' : accent}"/>` : ''}`;
  let body = text(48, 67, '大肥鱼 · BOT STATUS', 37, fg, 700) + text(48, 106, data.public ? 'QQ 功能状态简报' : `${data.version}  /  ${data.generatedAt}`, 20, muted);
  if (data.public) body += lines.map((line, i) => text(48, 175 + i * 54, short(line, 45), 25)).join('');
  else {
    body += box(32, 136, 936, 153) + text(56, 175, '当前模型', 21, muted) + text(56, 217, short(data.model, 54), 28, fg, 700) + text(56, 258, data.modelSource ?? '当前会话尚无可用模型快照', 20, muted);
    body += box(32, 305, 936, 114) + text(56, 342, '上下文占用', 21, muted) + text(56, 380, `${formatTokens(data.context.used)} / ${formatTokens(data.context.limit)} tokens`, 28) + meter(560, 365, data.context.limit > 0 && data.context.used != null ? data.context.used / data.context.limit * 100 : null, 380);
    for (const [index, label, value] of [[0, '今日观测用量', data.usage.today], [1, '本月观测用量', data.usage.month]]) {
      const x = 32 + index * 476;
      body += box(x, 435, 460, 153) + text(x + 24, 474, label, 21, muted) + text(x + 24, 520, value ? formatTokens(value.total) : '不可用', 37, accent, 700) + text(x + 24, 559, value ? `输入 ${formatTokens(value.input)}  /  输出 ${formatTokens(value.output)}` : '尚无可用的调用用量', 20, muted);
    }
    const rows = [ ['CPU 使用率', percent(data.host.cpuPercent), data.host.cpuPercent], ['内存', `${formatBytes(data.host.memory?.used)} / ${formatBytes(data.host.memory?.total)}`, data.host.memory?.total ? data.host.memory.used / data.host.memory.total * 100 : null], ['磁盘', `${formatBytes(data.host.disk?.used)} / ${formatBytes(data.host.disk?.total)}`, data.host.disk?.total ? data.host.disk.used / data.host.disk.total * 100 : null] ];
    body += box(32, 604, 936, 223);
    rows.forEach(([label, value, load], i) => { const y = 646 + i * 62; body += text(56, y, label, 23, muted) + text(240, y, value, 24) + meter(610, y - 12, load, 330); });
    const gpu = data.host.gpus?.[0];
    body += text(48, 866, gpu ? `GPU · ${short(gpu.name, 30)} · ${percent(gpu.percent)}` : 'GPU · 不可用或采集已关闭', 24) + text(48, 905, gpu ? `显存 ${formatBytes(gpu.used)} / ${formatBytes(gpu.total)}${data.host.gpus.length > 1 ? ` · 共 ${data.host.gpus.length} 张显卡，文字版显示全部` : ''}` : data.host.scope, 19, muted);
    body += text(48, 953, '可选功能', 27, fg, 700);
    data.features.forEach((feature, index) => { const x = 32 + (index % 2) * 476, y = 972 + Math.floor(index / 2) * 70; body += box(x, y, 460, 58) + text(x + 20, y + 37, feature.label, 22) + text(x + 160, y + 37, short(feature.status, 17), 20, feature.status.includes('失败') ? '#f5a76b' : muted); });
    body += text(48, 1008 + featureHeight, `任务  等待 ${data.tasks?.queued ?? '?'} / 运行 ${data.tasks?.running ?? '?'} / 待查询 ${data.tasks?.waiting ?? '?'}`, 20, muted);
  }
  const extras = data.public ? [] : (data.extra ?? []).slice(0, 8);
  const finalHeight = data.public ? height : height + 132 + extras.length * 36;
  extras.forEach((item, i) => { body += text(48, height + 58 + i * 36, short(`${item.id} · ${item.value}`, 62), 20, muted); });
  body += text(48, finalHeight - 63, data.public ? '详细状态仅管理员私聊可见' : `${data.usage.timeZone} · 插件观测用量可能不完整，不等同于供应商账单`, 19, muted) + text(48, finalHeight - 31, '未知字段显示不可用 · 查询不调用生成模型', 18, muted);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${finalHeight}" viewBox="0 0 1000 ${finalHeight}"><rect width="1000" height="${finalHeight}" fill="${bg}"/><g font-family="Fatfish Panel Sans, sans-serif">${body}</g></svg>`;
}

let wasmReady;
export async function renderStatus(data, options = {}) {
  const svg = statusSvg(data, options), fonts = { fontFiles: [options.fontPath || font], loadSystemFonts: false, defaultFontFamily: 'Fatfish Panel Sans' };
  try {
    if (options.engine === 'wasm') throw new Error('使用兼容渲染器。');
    const { Resvg } = await import('@resvg/resvg-js');
    return new Resvg(svg, { font: fonts }).render().asPng();
  } catch {
    if (options.engine === 'native') throw new Error('本机渲染器不可用。');
    const module = await import('@resvg/resvg-wasm');
    wasmReady ??= module.initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    await wasmReady;
    const renderer = new module.Resvg(svg, { font: { fontBuffers: [await readFile(options.fontPath || font)], loadSystemFonts: false, defaultFontFamily: 'Fatfish Panel Sans' } });
    try { const output = renderer.render(); try { return Buffer.from(output.asPng()); } finally { output.free(); } }
    finally { renderer.free(); }
  }
}
