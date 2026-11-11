# 可选功能：媒体链接解析（实验性）

把用户发来的平台链接解析成标题、作者、简介和媒体文件，再由机器人把媒体发回 QQ。下载层使用 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（Unlicense），平台适配由 yt-dlp 负责，本插件只做链接识别、下载、缓存与发送。

> 与 AstrBot 的 `astrbot_plugin_media_parser` 无关：那个项目是 AGPLv3 的 Python 实现，本项目是为了保持 MIT 许可而独立实现的精简版本，不复用其代码。

## 1. 安装 yt-dlp

在 **运行 OpenClaw Gateway 的同一台机器**安装，并确保 Gateway 进程能调用：

```bash
# Arch / Omarchy
sudo pacman -S yt-dlp

# Debian / Ubuntu
sudo apt install yt-dlp

# 或者用 pip（不污染系统 Python）
python3 -m pip install --user -U yt-dlp
```

验证：

```bash
yt-dlp --version
```

自定义路径时在配置里写 `parse.ytdlpPath`。**不要**把它指向一个可被他人替换的目录。

## 2. 配置

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": {
          "parse": {
            "enabled": true,
            "maxFileMb": 200,
            "maxDurationSeconds": 600,
            "cacheMaxMb": 1024,
            "cacheTtlDays": 7
          }
        }
      }
    }
  },
  "tools": { "alsoAllow": ["fatfish_parse_link"] }
}
```

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 初始开关；运行时可用 `/fish parse on\|off` 覆盖并持久化 |
| `ytdlpPath` | `yt-dlp` | 可执行文件路径或命令名 |
| `cookiesFile` | 无 | 可选的 Netscape 格式 Cookie 文件；B站等平台用数据中心 IP 访问会返回 412，提供 Cookie 能显著提高成功率 |
| `maxFileMb` | `200` | 一次下载结果的累计大小上限；同时向下载器传入单文件限制 |
| `maxConcurrent` | `2` | 所有会话合计的解析任务并发上限，最多 8 |
| `maxDurationSeconds` | `600` | 视频时长上限，`0` 表示不限制 |
| `timeoutSeconds` | `180` | 单次下载超时 |
| `cooldownSeconds` | `30` | 同一会话两次解析的最小间隔 |
| `cacheMaxMb` | `1024` | 缓存超过此体积时自动删最旧的文件 |
| `cacheTtlDays` | `7` | 超过天数的缓存文件会被删除 |
| `cleanupIntervalMinutes` | `60` | 后台清理的检查间隔 |
| `hosts` | 内置列表 | 允许解析的域名，留空用内置列表 |

## 3. 使用

管理员先在 QQ 里打开功能：

```text
/fish parse on      # 开启
/fish parse status  # 查看状态
/fish parse off     # 关闭
```

普通用户还需要权限：

```text
/fish allow parse on
```

之后把链接发给机器人即可。工具由模型调用：用户发链接并希望看内容时，模型调用 `fatfish_parse_link`，插件下载后通过当前 QQ 通道发送，并返回回执状态。模型无需再次调用消息工具，服务器路径不会出现在工具回复中。发送失败可按提示用 `/fish resend 编号` 重发已有文件。

## 4. 缓存与清理

缓存目录：`<OpenClaw 状态目录>/fatfish/cache/media`。

每次新下载使用独立任务目录，以 yt-dlp 的完成清单识别结果，不扫描其他用户的下载文件。同一链接可复用有效缓存；Cookie 文件变化后重新下载。清单中的越界路径、符号链接、半成品或累计超限结果会被拒绝，失败清理本次任务目录。缓存只保存链接摘要；发送记录保存在 `fatfish/deliveries/`，其中包含服务器路径和当前会话标识，请按私有运行数据管理。

清理策略（满足任一条件）：

- **按时间**：超过 `cacheTtlDays`（默认 7 天）的文件删除
- **按体积**：总量超过 `cacheMaxMb`（默认 1024 MB）时，从最旧的文件开始删，直到回到上限以内

后台清理每小时检查一次（`cleanupIntervalMinutes`），随 Gateway 服务启动和停止。正在下载或发送的文件在当前进程内受到保护，清理器不会同时删除；同一状态目录仍应只运行一个 Gateway。

## 5. 限制

- **只支持内置或管理员配置的域名**，带账号密码的 URL 一律拒绝；避免把内网地址交给 yt-dlp。
- **不支持直播和播放列表**，会直接报错。
- 各平台的风控、地区限制、付费内容由 yt-dlp 决定，插件不做绕过；解析失败时会返回可操作的原因。
- **B站返回 HTTP 412** 是它的风控（常见于云主机 IP）。导出浏览器 Cookie 为 Netscape 格式文件，在 `parse.cookiesFile` 里指向它即可；Cookie 属于账号凭据，注意文件权限，不要提交到仓库。
- 下载的媒体保存在本机，发送是否成功取决于通道对文件/视频的支持。
- 媒体解析需要模型支持工具调用；纯指令模式不会自动解析链接。
- 当前只在 Linux 上做过链路验证，Windows 路径与编码场景尚未实测。
