import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const API = 'https://api.github.com';
// 官方仓库优先；官方不可用时回退到用户的公开 fork，再往后可由管理员在配置里追加镜像。
export const DEFAULT_SNOWLUMA_SOURCES = ['SnowLuma/SnowLuma', 'Bigesila-B/SnowLuma'];

export function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'macos' : 'linux';
  const suffix = os === 'win' ? '.zip' : '.tar.gz';
  return (assets ?? []).find(asset =>
    typeof asset?.name === 'string' &&
    asset.name.includes(`-${os}-${arch}`) &&
    asset.name.endsWith(suffix) &&
    !asset.name.includes('lite') &&
    typeof asset.browser_download_url === 'string'
  ) ?? null;
}

export async function resolveRelease({ sources = DEFAULT_SNOWLUMA_SOURCES, platform, arch, fetchFn = fetch } = {}) {
  const tried = [];
  for (const source of sources) {
    const response = await fetchFn(`${API}/repos/${source}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'openclaw-fatfish' }
    });
    if (response.status === 404) { tried.push(`${source}（无可用 Release 或仓库不存在）`); continue; }
    if (!response.ok) throw new Error(`查询 ${source} 失败：HTTP ${response.status}`);
    const release = await response.json();
    const asset = pickAsset(release.assets, platform, arch);
    if (!asset) { tried.push(`${source}（没有 ${platform}-${arch} 的发行包）`); continue; }
    const checksums = (release.assets ?? []).find(item => item.name === 'checksums.sha256');
    return { source, tag: release.tag_name, asset, checksums };
  }
  throw new Error(`没有可用的 SnowLuma 发行包。已尝试：${tried.join('；')}。可在配置里用 snowluma.sources 追加镜像仓库。`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function expectedDigest(checksumsText, assetName) {
  if (typeof checksumsText !== 'string') return null;
  for (const line of checksumsText.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && match[2].trim() === assetName) return match[1].toLowerCase();
  }
  return null;
}

export function assertSafeEntries(entries) {
  for (const entry of entries) {
    const name = String(entry);
    if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error('发行包中包含不安全的路径，已拒绝解压。');
    }
  }
}

export function runCommand(command, args, { cwd, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error.code === 'ENOENT' ? new Error(`找不到命令 ${command}。`) : error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} 执行失败（退出码 ${code}）：${stderr.slice(-300)}`));
      else resolve({ stdout, stderr });
    });
  });
}

export function defaultInstallDir() {
  return join(homedir(), 'snowluma', 'app');
}

export async function installSnowluma({
  dir = defaultInstallDir(),
  sources = DEFAULT_SNOWLUMA_SOURCES,
  platform = process.platform,
  arch = process.arch,
  fetchFn = fetch,
  run = runCommand
} = {}) {
  const release = await resolveRelease({ sources, platform, arch, fetchFn });
  const buffer = Buffer.from(await (await fetchFn(release.asset.browser_download_url)).arrayBuffer());
  if (!buffer.length) throw new Error('下载到的发行包为空。');

  // 有 checksums.sha256 时强制校验，缺失时明确警告而不是静默放行。
  let verified = false;
  if (release.checksums?.browser_download_url) {
    const text = await (await fetchFn(release.checksums.browser_download_url)).text();
    const expected = expectedDigest(text, release.asset.name);
    if (!expected) throw new Error('校验文件中没有该发行包的摘要，已中止安装。');
    if (sha256(buffer) !== expected) throw new Error('发行包 sha256 与校验文件不一致，已中止安装。');
    verified = true;
  }

  // 先解压到临时目录并验证，成功后再替换现有安装；中途失败不会破坏已有版本。
  const stamp = Date.now();
  const archive = `${dir}.archive-${stamp}`;
  const staging = `${dir}.staging-${stamp}`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await writeFile(archive, buffer, { mode: 0o600 });
  try {
    const listing = await run('tar', ['-tf', archive]);
    assertSafeEntries(listing.stdout.split(/\r?\n/).filter(Boolean));
    await run('tar', ['-xf', archive, '-C', staging, '--no-same-owner']);

    const launcher = join(staging, platform === 'win32' ? 'launcher.bat' : 'launcher.sh');
    const info = await stat(launcher).catch(() => null);
    if (!info?.isFile()) throw new Error('解压后没有找到启动脚本，发行包可能不完整。');
    if (platform !== 'win32') await run('chmod', ['+x', launcher]);

    const backup = `${dir}.old-${stamp}`;
    const existing = await stat(dir).catch(() => null);
    if (existing) await rename(dir, backup);
    try {
      await rename(staging, dir);
    } catch (error) {
      if (existing) await rename(backup, dir).catch(() => {});
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }

  return { dir, source: release.source, tag: release.tag, asset: release.asset.name, verified };
}

export async function readInstalledVersion(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'release.json'), 'utf8'));
    return manifest?.version ?? null;
  } catch { return null; }
}
