import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateAgnes } from '../src/providers/agnes.js';
import { synthesizeMimo } from '../src/providers/mimo.js';
import { transcribeSilicon } from '../src/providers/siliconflow.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const wav = Buffer.from('524946460400000057415645', 'hex');

test('Agnes sends a base64 image request and saves a validated file', async () => {
  process.env.AGNES_API_KEY = 'test-only';
  let request;
  const result = await generateAgnes('image', 'fish', { enabled: true }, async (url, init) => {
    request = { url, body: JSON.parse(init.body), auth: init.headers.authorization };
    return json({ data: [{ b64_json: png.toString('base64') }] });
  });
  try {
    assert.equal(request.url, 'https://api.agnes-ai.cn/v1/images/generations');
    assert.equal(request.body.model, 'agnes-image-2.5-flash');
    assert.equal(request.body.return_base64, true);
    assert.equal(request.auth, 'Bearer test-only');
    assert.deepEqual(await readFile(result.filePath), png);
  } finally { await unlink(result.filePath); delete process.env.AGNES_API_KEY; }
});

test('Agnes reports busy without automatically submitting again', async () => {
  process.env.AGNES_API_KEY = 'test-only';
  let calls = 0;
  try { await assert.rejects(generateAgnes('video', 'fish', { enabled: true }, async () => { calls++; return new Response('', { status: 503 }); }), /503.*繁忙/); assert.equal(calls, 1); }
  finally { delete process.env.AGNES_API_KEY; }
});

test('MiMo uses the preset model and administrator-selected clone sample', async t => {
  process.env.MIMO_API_KEY = 'test-only';
  t.after(() => { delete process.env.MIMO_API_KEY; });
  const dir = await mkdtemp(join(tmpdir(), 'fatfish-clone-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sample = join(dir, 'sample.wav');
  await writeFile(sample, wav);
  let body;
  const mock = async (_url, init) => { body = JSON.parse(init.body); return json({ choices: [{ message: { audio: { data: wav.toString('base64') } } }] }); };
  let result = await synthesizeMimo('hello', {}, mock);
  assert.equal(body.model, 'mimo-v2.5-tts'); assert.equal(body.audio.voice, '冰糖');
  await unlink(result.filePath);
  result = await synthesizeMimo('hello', { cloneSamplePath: sample }, mock);
  assert.equal(body.model, 'mimo-v2.5-tts-voiceclone'); assert.match(body.audio.voice, /^data:audio\/wav;base64,/);
  assert.deepEqual(await readFile(result.filePath), wav);
  await unlink(result.filePath);
});

test('SiliconFlow receives a multipart file and returns transcript', async () => {
  let target, init;
  const result = await transcribeSilicon({ buffer: wav, fileName: 'sample.wav', mime: 'audio/wav', apiKey: 'test-only', fetchFn: async (url, options) => { target = url; init = options; return json({ text: '你好' }); } });
  assert.equal(target, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.equal(init.body.get('model'), 'TeleAI/TeleSpeechASR');
  assert.equal(init.body.get('file').name, 'sample.wav');
  assert.equal(result.text, '你好');
});

test('Agnes polls a created video after a temporary query failure without resubmitting', async () => {
  process.env.AGNES_API_KEY = 'test-only';
  let posts = 0, polls = 0;
  try {
    const result = await generateAgnes('video', 'fish', { enabled: true, timeoutSeconds: 10, allowedDownloadHosts: ['media.example.com'] }, async (url, init) => {
      if (init.method === 'POST') { posts++; return json({ video_id: 'job-1' }); }
      polls++;
      if (polls === 1) return new Response('', { status: 503 });
      return json({ status: 'completed', url: 'https://media.example.com/fish.mp4' });
    });
    assert.equal(posts, 1); assert.equal(polls, 2); assert.equal(result.filePath, 'https://media.example.com/fish.mp4');
  } finally { delete process.env.AGNES_API_KEY; }
});
