import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createUsageStore } from './usage.js';
import { createStatusService } from './index.js';
import { renderStatus } from './render.js';

export async function previewPanel(api, output) {
  if (!output?.toLowerCase().endsWith('.png')) throw new Error('预览输出文件必须以 .png 结尾。');
  const stateDir = api.runtime.state.resolveStateDir();
  const service = createStatusService(api, { stateDir, config: api.pluginConfig?.status, usage: createUsageStore(stateDir), isAdmin: () => true });
  const data = await service.snapshot({ channel: 'local', from: 'private:preview', senderId: 'preview' });
  data.modelSource = '本机预览，未绑定 QQ 会话';
  const buffer = await renderStatus(data, await service.settings());
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer, { mode: 0o600 });
  return path;
}
