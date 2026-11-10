// 链接识别：只放行明确列出的公开平台域名，避免把任意地址（含内网地址）交给 yt-dlp 访问。
// 允许列表可由管理员通过 parse.hosts 覆盖。
export const DEFAULT_PARSE_HOSTS = [
  'bilibili.com', 'b23.tv', 'bilibili.tv',
  'douyin.com', 'iesdouyin.com',
  'kuaishou.com', 'xiaohongshu.com', 'xhslink.com',
  'weibo.com', 'weibo.cn', 'zhihu.com', 'toutiao.com', 'acfun.cn',
  'music.163.com', 'ximalaya.com',
  'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'tiktok.com',
  'instagram.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com',
  'github.com', 'gitee.com'
];

function trimTrailing(raw) {
  return raw.replace(/[.,;:!?，。；：！？、]+$/u, '');
}

export function extractUrls(text) {
  if (typeof text !== 'string') return [];
  // 遇到空白、中文标点或中文字符就截断，避免把「链接，还有」整段当成 URL。
  const matches = text.match(/https?:\/\/[^\s<>"'）)】\]，。；：！？、\u3000-\u303f\u4e00-\u9fff]+/gu) ?? [];
  return [...new Set(matches.map(trimTrailing).filter(Boolean))];
}

export function isSupported(url, hosts = DEFAULT_PARSE_HOSTS) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  // 带账号密码的地址一律拒绝，避免把凭据带进第三方解析器。
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return hosts.some(entry => {
    const allowed = String(entry).toLowerCase();
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

export function firstSupportedUrl(text, hosts) {
  return extractUrls(text).find(url => isSupported(url, hosts));
}
