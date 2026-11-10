import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const repository = 'https://github.com/Bigesila-B/video-context-builder-skills.git';
// 固定到已人工审阅的提交。上游默认分支随时可能变化，只有显式升级这里才会换版本，
// 避免“每次安装都拉最新代码并立刻执行”带来供应链风险。
export const pinnedVideoSkillCommit = '44be7e702255126432cbfcb018e2e4c112e27a0c';
const required = {
  'scripts/build_video_context.py': ['def build_video_context(', 'max_tokens', 'stt_api_options'],
  'scripts/probe_video.py': ['def probe_video('],
  'scripts/ffmpeg_utils.py': ['def run(', 'def ffmpeg('],
  'scripts/transcribe.py': ['def transcribe('],
  'scripts/adaptive_sampling.py': [],
  'scripts/extract_frames.py': [],
  'scripts/make_contact_sheet.py': [],
  'scripts/make_second_sheets.py': [],
  'scripts/prompt_builder.py': [],
  'scripts/token_estimator.py': [],
  'scripts/stt_api.py': [],
  'scripts/stt_config.py': [],
  'LICENSE': ['MIT License'],
  'SKILL.md': ['video-context-builder']
};

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill(); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法运行 Git，请安装 Git 并检查网络。')); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0 || timedOut) reject(new Error('下载视频技能失败，请检查 Git 与 GitHub 网络连接。')); else resolve(stdout.trim()); });
  });
}
async function verifyCandidate(dir) {
  for (const [name, needles] of Object.entries(required)) {
    let content;
    try { content = await readFile(join(dir, name), 'utf8'); } catch { throw new Error('最新版视频技能文件不完整，当前已安装版本不会改变。'); }
    if (content.length > 2 * 1024 * 1024 || needles.some(value => !content.includes(value))) throw new Error('最新版视频技能接口发生变化，当前已安装版本不会改变；请检查兼容性。');
  }
}
export function videoSkillRoot(stateDir) {
  if (typeof stateDir !== 'string' || !isAbsolute(stateDir)) throw new Error('OpenClaw 状态目录无效。');
  return join(stateDir, 'fatfish', 'video-context-builder');
}
export async function resolveVideoSkill(stateDir) {
  const root = videoSkillRoot(stateDir);
  let value;
  try { value = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')); }
  catch { throw new Error('尚未安装看视频引擎；请运行 openclaw fatfish install-video-skill。'); }
  if (!/^[0-9a-f]{40}$/.test(value?.commit ?? '')) throw new Error('看视频引擎版本记录无效，请重新安装。');
  const path = join(root, 'versions', value.commit);
  try { await verifyCandidate(path); } catch { throw new Error('看视频引擎文件不完整或不兼容，请重新安装。'); }
  return { path, commit: value.commit };
}
export async function installVideoSkill(stateDir, { git = runGit, commit = pinnedVideoSkillCommit } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('视频技能版本号无效。');
  const root = videoSkillRoot(stateDir);
  const versions = join(root, 'versions');
  await mkdir(versions, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, 'download-'));
  const subpath = relative(root, staging);
  if (!subpath.startsWith('download-') || subpath.includes(sep) || isAbsolute(subpath)) throw new Error('临时安装目录无效。');
  try {
    // 用 init + fetch 指定提交代替 clone 默认分支：拿到的一定是审阅过的那个版本。
    await git(['-c', 'core.hooksPath=', '-c', 'core.autocrlf=false', 'init', '-q', staging]);
    await git(['remote', 'add', 'origin', repository], staging);
    await git(['fetch', '--depth', '1', 'origin', commit], staging);
    await git(['checkout', '-q', 'FETCH_HEAD'], staging);
    const actual = (await git(['rev-parse', 'HEAD'], staging)).toLowerCase();
    if (actual !== commit) throw new Error('下载的视频技能提交与固定版本不一致，已拒绝安装。');
    await verifyCandidate(staging);
    const target = join(versions, commit);
    let exists = false;
    try { exists = (await stat(target)).isDirectory(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) await rename(staging, target);
    else await verifyCandidate(target);
    const temp = join(root, `current-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ commit, source: repository, installedAt: new Date().toISOString() }) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, join(root, 'current.json'));
    } finally { await rm(temp, { force: true }); }
    return { commit, path: target };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
