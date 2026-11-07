import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateComfy } from '../src/comfy.js';

test('submits a configured workflow and retrieves its output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fatfish-comfy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowPath = join(root, 'workflow.json');
  await writeFile(workflowPath, JSON.stringify({ '1': { inputs: { text: 'original' } } }));
  let submitted;
  const server = createServer(async (req, res) => {
    if (req.url === '/prompt') {
      let body = '';
      for await (const chunk of req) body += chunk;
      submitted = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ prompt_id: 'task-123' }));
    }
    if (req.url === '/history/task-123') {
      res.setHeader('content-type', 'application/json');
      const output = submitted.prompt['1'].inputs.text === 'video' ? { videos: [{ filename: 'video.mp4', subfolder: '', type: 'output' }] } : { images: [{ filename: 'image.png', subfolder: '', type: 'output' }] };
      return res.end(JSON.stringify({ 'task-123': { status: { completed: true }, outputs: { '2': output } } }));
    }
    if (req.url.startsWith('/view?')) return res.end('example-image');
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const options = { enabled: true, url: `http://127.0.0.1:${server.address().port}`, workflowPath, promptNode: '1', outputNode: '2', kind: 'image' };
  const result = await generateComfy('一条鱼', options);
  try {
    assert.equal(submitted.prompt['1'].inputs.text, '一条鱼');
    assert.equal(await readFile(result.filePath, 'utf8'), 'example-image');
  } finally { await unlink(result.filePath); }
  const video = await generateComfy('video', { ...options, kind: 'video' });
  try { assert.match(video.filePath, /\.mp4$/); } finally { await unlink(video.filePath); }
});

test('rejects remote endpoints and disabled capability', async () => {
  await assert.rejects(generateComfy('x', { enabled: false }), /未启用/);
  await assert.rejects(generateComfy('x', { enabled: true, url: 'http://example.com' }), /本机/);
});
