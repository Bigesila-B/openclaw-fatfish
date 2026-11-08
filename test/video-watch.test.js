import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildVideoContext, resolveWatchStt } from '../src/video-watch.js';

const mp4 = Buffer.concat([Buffer.from('0000001866747970', 'hex'), Buffer.alloc(16)]);
const jpg = Buffer.from('ffd8ff000000', 'hex');

test('video STT reuses configured model or can be independently overridden', () => {
  assert.equal(resolveWatchStt({}, {}).mode, 'off');
  assert.deepEqual(resolveWatchStt({}, { enabled: true, model: 'TeleAI/TeleSpeechASR' }), {
    mode: 'api', baseUrl: 'https://api.siliconflow.cn/v1', model: 'TeleAI/TeleSpeechASR', keyEnv: 'SILICONFLOW_API_KEY', responseFormat: 'json'
  });
  assert.equal(resolveWatchStt({ stt: { mode: 'local', model: 'base' } }, {}).model, 'base');
  assert.equal(resolveWatchStt({ stt: { mode: 'off' } }, { enabled: true }).mode, 'off');
  assert.throws(() => resolveWatchStt({ stt: { mode: 'api', baseUrl: 'http://example.com', model: 'm', keyEnv: 'KEY' } }), /HTTPS/);
});

test('video files become bounded ordered image tool results and temporary data is cleaned', async () => {
  let root, options, payload;
  const result = await buildVideoContext({
    url: 'https://example.com/video.mp4', question: '发生了什么？', config: { enabled: true, stt: { mode: 'off' } },
    fetchMedia: async o => { options = o; return { buffer: mp4 }; },
    run: async (_python, p) => {
      payload = p; root = p.assets;
      await mkdir(join(root, 'sheets'), { recursive: true });
      const image = join(root, 'sheets', 'one.jpg'); await writeFile(image, jpg);
      await writeFile(p.output, JSON.stringify({ budget: { ready_to_send: true }, prompt: '按照时间阅读图像。', overview_sheets: [{ path: image }], second_sheets: [], meta: { duration: 3 }, transcript_info: { status: 'skipped' }, token_estimate: { total: 42 } }));
    }
  });
  assert.equal(options.maxRedirects, 0);
  assert.equal(payload.stt.mode, 'off');
  assert.equal(result.content[1].type, 'image');
  assert.equal(result.content[1].data, jpg.toString('base64'));
  assert.equal(result.details.duration, 3);
  await assert.rejects(readFile(join(root, 'sheets', 'one.jpg')), { code: 'ENOENT' });
});

test('disabled feature, invalid sources and unbudgeted output fail closed', async () => {
  const fetchMedia = async () => ({ buffer: mp4 });
  await assert.rejects(buildVideoContext({ url: 'https://example.com/v.mp4', question: '摘要', fetchMedia }), /未启用/);
  await assert.rejects(buildVideoContext({ url: 'file:///etc/passwd', question: '摘要', config: { enabled: true }, fetchMedia }), /HTTPS/);
  await assert.rejects(buildVideoContext({ url: 'https://example.com/page', question: '摘要', config: { enabled: true }, fetchMedia: async () => ({ buffer: Buffer.from('<html>not a video</html>') }) }), /仅支持/);
  await assert.rejects(buildVideoContext({ url: 'https://example.com/v.mp4', question: '摘要', config: { enabled: true }, fetchMedia, run: async (_p, p) => writeFile(p.output, JSON.stringify({ budget: { ready_to_send: false }, prompt: '' })) }), /预算/);
});
