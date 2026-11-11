import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { installVideoSkill, resolveVideoSkill, rollbackVideoSkill } from '../src/video-skill-install.js';

const firstCommit = 'a'.repeat(40);

// 只模拟安装流程用到的 git 子命令：init / remote add / fetch / checkout / rev-parse。
// checkout 时才把文件写进仓库目录，rev-parse 返回当前 HEAD。
function fakeGit({ head = firstCommit, valid = true, calls = [] } = {}) {
  return async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return head;
    if (args[0] === 'checkout') {
      const files = {
        'scripts/build_video_context.py': 'def build_video_context(\n max_tokens, stt_api_options): pass',
        'scripts/probe_video.py': 'def probe_video(x): pass',
        'scripts/ffmpeg_utils.py': 'def run(x): pass\ndef ffmpeg(x): pass',
        'scripts/transcribe.py': 'def transcribe(x): pass',
        'scripts/adaptive_sampling.py': '', 'scripts/extract_frames.py': '', 'scripts/make_contact_sheet.py': '',
        'scripts/make_second_sheets.py': '', 'scripts/prompt_builder.py': '', 'scripts/token_estimator.py': '',
        'scripts/stt_api.py': '', 'scripts/stt_config.py': '', 'LICENSE': 'MIT License', 'SKILL.md': 'video-context-builder'
      };
      if (!valid) delete files['scripts/probe_video.py'];
      for (const [file, text] of Object.entries(files)) {
        const path = join(cwd, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      }
    }
    return '';
  };
}

test('默认安装上游 HEAD，记录提交，更新失败保留旧版并可回退', async t => {
  const state = await mkdtemp(join(tmpdir(), 'fatfish-skill-test-'));
  t.after(() => rm(state, { recursive: true, force: true }));

  await assert.rejects(resolveVideoSkill(state), /尚未安装/);

  const calls = [];
  const first = await installVideoSkill(state, { git: fakeGit({ calls }) });
  assert.equal(first.commit, firstCommit);
  assert.equal((await resolveVideoSkill(state)).commit, firstCommit);
  assert.deepEqual(calls.find(args => args[0] === 'fetch'), ['fetch', '--depth', '1', 'origin', 'HEAD']);
  await assert.rejects(rollbackVideoSkill(state), /没有可回退/);

  // 上游 HEAD 与固定提交不一致时必须拒绝，避免把未审阅的代码装入可执行目录。
  await assert.rejects(
    installVideoSkill(state, { git: fakeGit({ head: 'b'.repeat(40) }), commit: firstCommit }),
    /不一致/
  );
  assert.equal((await resolveVideoSkill(state)).commit, firstCommit);

  // 文件不完整时保留已有版本。
  await assert.rejects(installVideoSkill(state, { git: fakeGit({ valid: false, head: 'b'.repeat(40) }) }), /不完整/);
  assert.equal((await resolveVideoSkill(state)).commit, firstCommit);
  const next = 'b'.repeat(40);
  await installVideoSkill(state, { git: fakeGit({ head: next }) });
  assert.equal((await resolveVideoSkill(state)).commit, next);
  await installVideoSkill(state, { git: fakeGit({ head: next }) });
  await rollbackVideoSkill(state);
  assert.equal((await resolveVideoSkill(state)).commit, firstCommit);
  await assert.rejects(installVideoSkill(state, { git: async () => { throw new Error('离线'); } }), /离线/);
  assert.equal((await resolveVideoSkill(state)).commit, firstCommit);
});
