# QQ 语音与视频附件

插件消费 OpenClaw 标准 `media` 事实，为当前用户的音频和视频创建短期编号。可以发送语音后说“帮我转成文字”，或发送视频后说“总结这个视频”。模型调用 `fatfish_transcribe_audio` 或 `fatfish_watch_video`，不需要获取服务器文件路径。

前提是 QQ 通道与宿主确实提供 `media`（`kind/contentType` 及 `path/url`）。旧通道只给正文时不能自动识别，插件不会猜测 OneBot 文件地址。视频可降级为 HTTPS 文件直链，语音可改发 WAV/MP3。未完成暂存的 `originalMedia` 不能作为本地文件读取。真实 SnowLuma / QQBot 附件链路仍需现场验证。

## 开启

1. 按[云模型教程](cloud-providers.md)启用 STT，并为 Gateway 配置 `SILICONFLOW_API_KEY`。
2. 保留 `tools.alsoAllow:["fatfish"]`；普通用户需 `/fish allow stt on`。看视频需另行启用、安装[视频技能](video-watch.md)并授权 `watch`。
3. 安装 FFmpeg，确保 Gateway 能执行；也可在 `attachments.ffmpegPath` 配置绝对路径。语音转换为 16 kHz 单声道 WAV 后交给 STT。视频使用其独立的 Python / FFmpeg 配置。
4. 如需给模型提示附件编号，在插件 `hooks` 中启用 `allowConversationAccess:true`，且不显式禁止提示修改。后者在不同宿主版本字段名不同，详见[人格教程](persona.md)。显式工具不传编号也可选取当前用户最近的可用附件。

`plugins.entries.fatfish.config.attachments` 支持 `maxMb`（默认及最大 50 MB）、`maxAudioSeconds`（默认 120，最大 600 秒）、`ttlMinutes`（默认 10）、`ffmpegPath`（默认 `ffmpeg`）。过长音频会拒绝，不会静默截断冒充完整识别。FFmpeg 通常不能解码 QQ 私有 SILK，需要通道转换或改发标准音频；不承诺所有 QQ 语音编码可解。

索引只在内存中，过期或重启失效；按用户、通道、账号及会话绑定。只读取宿主媒体目录/明确暂存工作区内的真实文件；远程地址经过宿主安全下载器，限制大小、超时及跳转。读取前后重查权限，不接受模型传入任意服务器路径或下载地址。

宿主自动音频理解是 OpenClaw 独立功能。`/fish allow stt` 管理大肥鱼显式工具，不能代替宿主/通道自身对自动转写的访问控制。
