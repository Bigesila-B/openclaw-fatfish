# 可选功能：看视频（实验性）

大肥鱼集成 [Video Context Builder](https://github.com/Bigesila-B/video-context-builder-skills)（MIT）：先抽取带时间的画面拼图，并可选转写音频，再把这些材料交给当前支持看图的聊天模型回答。它不是逐帧看完整视频；回答应标注时间，区分画面和语音，未采样的内容不能推断。音频模型仅返回整段或音频块文本时，时间戳是粗略范围，不代表逐句精确时间。

**当前输入限制：只支持可直接下载的 HTTPS MP4/MOV/WebM 文件地址，不支持普通网页、短视频平台分享页、重定向链接或服务器本地路径。** 目前 SnowLuma 通道尚未将收到的 QQ 视频附件作为视频传给此功能，QQ 直接发送视频暂不能保证触发；可先在 QQ 中提供用户有权访问的视频直链。模型需要支持图像输入，且用户请求必须经过通道和插件的权限检查。注意：对话中的视频地址可能包含访问令牌，请只在可信会话使用。

## 1. 安装依赖

在运行 Gateway 的机器准备 Python 3.10 或更新版本、Pillow 和 imageio-ffmpeg。例如创建虚拟环境：

```bash
python -m venv .venv-video
```

Windows PowerShell：

```powershell
.\.venv-video\Scripts\python.exe -m pip install Pillow imageio-ffmpeg
```

Linux/macOS：

```bash
.venv-video/bin/python -m pip install Pillow imageio-ffmpeg
```

用该虚拟环境 Python 的绝对路径配置下面的 `python`。默认复用云端 STT，不需要安装 faster-whisper；选用本地转写时才需要额外安装 `faster-whisper` 及模型。FFmpeg 及模型首次下载可能需要网络，GPU 和长视频会消耗计算资源。

## 2. 启用并复用大肥鱼 STT

先按[云模型教程](cloud-providers.md)设置 `SILICONFLOW_API_KEY`，让运行 Gateway 的进程能够读取。将示例合并进 OpenClaw 配置，保留已有管理员、工具和其他设置。Windows JSON 路径中的反斜杠要写成 `\\`。

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": {
          "admins": ["123456789"],
          "stt": {"enabled": true, "model": "TeleAI/TeleSpeechASR"},
          "watchVideo": {
            "enabled": true,
            "python": "/absolute/path/to/.venv-video/bin/python",
            "maxDurationSeconds": 120,
            "timeoutSeconds": 180,
            "maxTokens": 8000,
            "stt": {"mode": "reuse"}
          }
        }
      }
    }
  },
  "tools": {"allow": ["fatfish_watch_video"]}
}
```

这里的 `reuse` 复用大肥鱼 `stt` 中的硅基流动模型和 `SILICONFLOW_API_KEY`；它不会自动读取任意其他 OpenClaw 转写供应商。如果 `stt.enabled` 未启用，`reuse` 模式只分析画面，不上传音频。`maxTokens` 是一次材料调用的估算预算，不是费用保证；模型本身还会产生输出 token。文件上限为 50 MB、图片上限为 20 张，默认视频时长上限 120 秒，可由管理员配置为最多 600 秒。

执行 `openclaw config validate`，重启 Gateway，并运行 `openclaw skills info fatfish-watch-video` 检查技能是否就绪。管理员在 QQ 请求：“帮我看看这个视频讲了什么：`https://example.com/video.mp4`”。这是示例地址，请替换为实际可下载文件。普通 QQ 用户默认无权使用，管理员可用 `/fish allow watch on` 开放，`/fish allow watch off` 关闭；`/fish permissions` 查看当前权限。OpenClaw 的工具允许列表和 SnowLuma 自身授权仍然有效。

## 3. 单独选择 STT 模型

只分析画面：

```json
{"stt":{"mode":"off"}}
```

单独使用本地 faster-whisper（需自行安装依赖及模型）：

```json
{"stt":{"mode":"local","model":"small"}}
```

单独使用兼容 OpenAI 音频转写接口的 HTTPS 服务（请核对服务商文档和模型兼容性）：

```json
{"stt":{"mode":"api","baseUrl":"https://your-provider.example/v1","model":"your-model-id","keyEnv":"MY_VIDEO_STT_KEY","responseFormat":"json"}}
```

上述片段替换 `watchVideo.stt`，`keyEnv` 是环境变量的**名字**，不是密钥本身。确保 Gateway 进程中设置对应密钥。`responseFormat` 可按服务商改为 `json`、`verbose_json`、`text` 或 `diarized_json`；并非所有供应商支持所有格式。该配置由管理员设置，聊天用户不能指定服务地址或密钥。使用云 STT 会将视频音轨上传给对应供应商，请只处理有权处理的内容。

## 4. 排错与限制

- 没有反应：检查机器人使用支持图片的聊天模型、已允许工具、技能已就绪、QQ 发送者身份可信，以及普通用户权限是否开启。
- 下载失败：链接须直接返回公网 HTTPS 视频文件，不跟随跳转；插件使用 OpenClaw 的下载保护和大小限制，拒绝内网地址。不要将视频文件直链与网页分享链接混淆。
- 视频无法解析：检查格式、依赖、视频大小和时长；默认仅同时处理一个视频，运行超时或过长的视频请缩短后重试。
- 听不到内容：确认视频有音轨、STT 已启用、环境变量在 Gateway 进程中可用。上游出错时画面分析仍可能继续，回复应说明转写未成功；转写失败不会自动改用其他供应商。
- 处理过程会在系统临时目录创建视频和抽帧文件，正常完成或失败会尝试清理；进程或系统被强制结束时可能残留。建议在权限受限的独立运行环境中处理不可信视频并定期检查临时目录。
- QQ 收发和完整的“消息→工具→看图模型→QQ 回复”链路仍需真实环境验证。本次已用测试视频验证抽帧和硅基流动音轨转写，也验证 Agnes 能接收提取的测试图片。
