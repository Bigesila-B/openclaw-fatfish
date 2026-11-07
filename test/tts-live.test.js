import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat, unlink } from 'node:fs/promises';
import { synthesize } from '../src/tts.js';

test('Edge TTS generates an MP3 with configured Python', { skip: !process.env.FATFISH_TEST_PYTHON, timeout: 70000 }, async () => {
  const result = await synthesize('你好，大肥鱼。', { python: process.env.FATFISH_TEST_PYTHON });
  try {
    assert.ok((await stat(result.filePath)).size > 100);
  } finally {
    await unlink(result.filePath);
  }
});
