import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { installVideoSkill, resolveVideoSkill } from '../src/video-skill-install.js';

function fakeGit(commit, valid = true) {
  return async (args, cwd) => {
    if (args[0] === 'rev-parse') return commit;
    const dest = args.at(-1);
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
      const path = join(dest, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text);
    }
  };
}

test('each install chooses the latest checkout and failed updates preserve the previous version', async t => {
  const state = await mkdtemp(join(tmpdir(), 'fatfish-skill-test-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  await assert.rejects(resolveVideoSkill(state), /尚未安装/);
  const first = 'a'.repeat(40), second = 'b'.repeat(40);
  assert.equal((await installVideoSkill(state, { git: fakeGit(first) })).commit, first);
  assert.equal((await resolveVideoSkill(state)).commit, first);
  assert.equal((await installVideoSkill(state, { git: fakeGit(second) })).commit, second);
  assert.equal((await resolveVideoSkill(state)).commit, second);
  await assert.rejects(installVideoSkill(state, { git: fakeGit('c'.repeat(40), false) }), /不完整/);
  assert.equal((await resolveVideoSkill(state)).commit, second);
});
