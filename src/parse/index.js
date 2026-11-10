import { probe, download } from './ytdlp.js';

const MAX_DESCRIPTION_IN_TEXT = 300;

export async function parseMediaLink(url, {
  bin, cacheDir, maxBytes, maxDurationSeconds = 0, timeoutSeconds = 180, run, cookiesFile
} = {}) {
  const info = await probe(url, { bin, timeoutMs: 60000, run, cookiesFile });
  if (info.isLive) throw new Error('不解析直播链接，请提供已结束的视频或图文内容。');
  if (maxDurationSeconds > 0 && info.duration > maxDurationSeconds) {
    throw new Error(`视频时长约 ${Math.round(info.duration)} 秒，超过上限 ${maxDurationSeconds} 秒。`);
  }
  const files = await download(url, {
    bin,
    dir: cacheDir,
    maxBytes,
    timeoutMs: timeoutSeconds * 1000,
    run,
    cookiesFile
  });
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    info,
    files,
    totalBytes,
    // 给模型看的摘要，保持简短；完整信息放在 details 里。
    summary: [
      info.title && `标题：${info.title}`,
      info.uploader && `作者：${info.uploader}`,
      info.duration > 0 && `时长：${Math.round(info.duration)} 秒`,
      info.description && `简介：${info.description.slice(0, MAX_DESCRIPTION_IN_TEXT)}`,
      `媒体：${files.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`
    ].filter(Boolean).join('\n')
  };
}
