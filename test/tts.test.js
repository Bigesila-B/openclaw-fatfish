import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { synthesize } from '../src/tts.js';

test('returns generated audio and passes text as structured input', async () => {
  let sent;
  const result = await synthesize('你好，大肥鱼', {}, async (_python, _script, payload) => {
    sent = payload;
    await writeFile(payload.output, 'audio');
  });
  assert.equal(sent.text, '你好，大肥鱼');
  assert.equal(sent.voice, 'zh-CN-XiaoxiaoNeural');
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(await readFile(result.filePath, 'utf8'), 'audio');
  await unlink(result.filePath);
});

test('rejects invalid text and voice', async () => {
  await assert.rejects(synthesize('   '), /文本/);
  await assert.rejects(synthesize('x'.repeat(1001)), /文本/);
  await assert.rejects(synthesize('hello', { voice: '../unsafe' }), /音色/);
});

test('removes output on provider failure', async () => {
  let target;
  await assert.rejects(synthesize('test', {}, async (_python, _script, payload) => {
    target = payload.output;
    await writeFile(target, 'partial');
    throw new Error('provider error');
  }), /provider error/);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
});
