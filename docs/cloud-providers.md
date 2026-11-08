# Agnes、MiMo 和硅基流动云模型（实验性）

功能默认关闭，按需启用；模型 ID 可由管理员修改，但本插件的媒体适配器目前固定连接下面三家的中国站 HTTPS 接口，不代表兼容任意供应商的协议。价格、限免、额度及可用性会变化，请使用前到各平台确认。本项目不提供或保存 API 密钥。

- [Agnes 聊天模型](https://www.agnes-ai.com/zh-Hans/docs/agnes-30-flash)、[生图](https://www.agnes-ai.com/zh-Hans/docs/agnes-image-25-flash)、[生视频](https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash)。中国站密钥从 [Agnes 中国站](https://platform.agnes-ai.cn/settings/apiKeys)申请，与国际站密钥不一定通用。
- [MiMo 语音合成和克隆](https://mimo.mi.com/docs/usage-guide/speech-synthesis-v2.5)，[官方接口示例](https://github.com/XiaomiMiMo/MiMo-Skills/tree/main/skills/mimo-v2-5-tts/scripts)。
- [硅基流动语音识别](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)。

## 1. 在 Gateway 进程设置密钥

在运行 OpenClaw Gateway 的环境设置 `AGNES_API_KEY`、`MIMO_API_KEY` 和 `SILICONFLOW_API_KEY`，只设置需要的项。Windows PowerShell 当前终端示例（把提示值替换为自己的密钥，避免复制到仓库）：

```powershell
$env:AGNES_API_KEY = '<自己的 Agnes 中国站密钥>'
$env:MIMO_API_KEY = '<自己的 MiMo 密钥>'
$env:SILICONFLOW_API_KEY = '<自己的硅基流动密钥>'
```

Linux/macOS：

```bash
export AGNES_API_KEY='<自己的 Agnes 中国站密钥>'
export MIMO_API_KEY='<自己的 MiMo 密钥>'
export SILICONFLOW_API_KEY='<自己的硅基流动密钥>'
```

从设置环境变量的同一终端启动 Gateway；如果使用系统服务、Docker 或面板，需要通过该运行环境的密钥管理配置，使 **Gateway 进程**也能读取。重启 Gateway 生效。不要将密钥提交 GitHub，也不要发在 QQ 群中。聊天模型采用 OpenClaw 的环境变量引用，不要将真实值直接放入共享配置。

## 2. 配置 Agnes 聊天模型

将以下内容合并到 OpenClaw 配置，不要覆盖现有配置；其他聊天模型可继续在 OpenClaw 里自行配置和切换。默认指定 512000 上下文为官方文档的 512K 标称值，具体可用量以实际服务为准。

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "agnes-cn": {
        "baseUrl": "https://api.agnes-ai.cn/v1",
        "apiKey": "${AGNES_API_KEY}",
        "api": "openai-completions",
        "models": [{"id":"agnes-3.0-flash","name":"Agnes 3.0 Flash","reasoning":false,"input":["text","image"],"contextWindow":512000,"maxTokens":65536}]
      }
    }
  },
  "agents": {"defaults":{"model":{"primary":"agnes-cn/agnes-3.0-flash"}}}
}
```

模型配置同样可以在 `openclaw fatfish setup` 的第一步通过 OpenClaw 官方模型向导完成。设置环境变量后运行 `openclaw config validate` 检查配置并重启 Gateway。工具调用由模型决定，仍需允许工具并由插件进行 QQ 权限检查。

## 3. 按需启用媒体功能

将需要的项目合并到 `plugins.entries.fatfish.config`，将工具名合并到已有的 `tools.allow`（不要覆盖原有允许列表）。下面示例包含全部功能；不需要的项目设置 `enabled: false` 或删去。`admins` 改成自己的 QQ 号。

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": {
          "admins": ["123456789"],
          "image": {"enabled":true,"provider":"agnes","model":"agnes-image-2.5-flash","size":"1K"},
          "video": {"enabled":true,"provider":"agnes","model":"agnes-video-2.5-flash","seconds":4,"timeoutSeconds":300,"allowedDownloadHosts":[]},
          "tts": {"enabled":true,"provider":"mimo","model":"mimo-v2.5-tts","voice":"冰糖"},
          "stt": {"enabled":true,"model":"TeleAI/TeleSpeechASR"}
        }
      }
    }
  },
  "tools": {
    "allow": ["fatfish_tts", "fatfish_generate_image", "fatfish_generate_video"],
    "media": {"audio":{"enabled":true,"models":[{"provider":"fatfish-siliconflow","model":"TeleAI/TeleSpeechASR"}]}}
  }
}
```

配置完成运行 `openclaw config validate`，重启 Gateway。管理员先试 `/fish image 一条大肥鱼`；自然语言如“帮我画一条大肥鱼”也可触发生图工具。生图和视频的普通用户权限默认关闭，管理员可用 `/fish allow image on`、`/fish allow video on` 分别开启。请关注配额与用量。视频用 `/fish video 一条鱼在海里游泳`，上游繁忙时可能返回 HTTP 503；稍后手动重试，插件不会自动重复创建任务。

视频创建成功后会返回任务编号，插件轮询状态；超时或查询失败时任务可能仍在运行，不应重复提交。当前没有跨重启持久任务队列；可按 [官方文档](https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash)凭错误提示中的任务编号查询。视频完成后，为限制外部地址，只允许发送 `allowedDownloadHosts` 中的 HTTPS 域名。先核实服务商返回的域名后填入该数组并重启；列表为空时不会发送视频。已经完成的任务需按官方查询接口取回结果；不要为此重复创建任务。远程视频地址需要 SnowLuma 所在环境也能访问；该通道可能将视频作为文件上传而非内嵌视频。

## 4. 使用和切换音色

MiMo 预置音色例如 `冰糖`、`茉莉`、`苏打`、`白桦`；修改 `tts.voice` 后重启 Gateway。也可以设置 `tts.model` 为服务商支持且协议相同的模型。

克隆音色时，管理员先获得声音提供者同意，将授权样本放在 Gateway 可读且其他人无法随意更改的本机文件中（WAV 或 MP3，最大 10 MB），然后在 `tts` 配置中加入：

```json
{"cloneSamplePath":"/absolute/path/to/authorized-voice.wav","cloneModel":"mimo-v2.5-tts-voiceclone"}
```

设置样本后每次合成会把样本传给 MiMo，并使用克隆模型而非预置音色；切换样本需要管理员修改配置并重启。删除 `cloneSamplePath` 可恢复预置音色。不要通过聊天让模型决定服务器文件路径；样本和生成语音应视为敏感数据。插件将 WAV 文件临时保存在系统临时目录 `openclaw-fatfish-generated`，请自行清理。让机器人“用语音说你好”可触发工具；是否能发送为 QQ 语音取决于 SnowLuma 的文件访问和音频格式，尚未进行真实 QQ 端到端验证。

## 5. 语音识别限制

硅基流动接口已使用合成音频验证成功，插件注册了 OpenClaw 音频识别供应商。**当前 SnowLuma 通道的 QQ 收到语音到 OpenClaw 音频附件的链路尚未验证或补齐**，所以配置 STT 并不代表 QQ 语音已可自动识别。QQ 媒体的接收和发送需要实际环境联调。

上传音频给硅基流动时不要超过服务商限制（当前文档为 50 MB、1 小时），也要遵循 OpenClaw 自身的音频大小限制。服务商会收到音频内容，请自行决定适用场景。
