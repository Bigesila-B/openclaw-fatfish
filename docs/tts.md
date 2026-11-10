# 可选功能：Edge TTS（实验性）

该功能将文本发送到 Edge 在线语音服务，并在本机生成 MP3。请先确认自己允许把文本发送给第三方；服务可用性、语音列表和使用条件可能改变。上游项目：[edge-tts](https://github.com/rany2/edge-tts)。

## 1. 安装 Python 包

在 **运行 OpenClaw Gateway 的同一台机器**，创建独立 Python 虚拟环境并安装：

```bash
python -m venv .venv-tts
```

Windows PowerShell：

```powershell
.\.venv-tts\Scripts\python.exe -m pip install edge-tts
.\.venv-tts\Scripts\python.exe -m edge_tts --text "你好，大肥鱼" --write-media test.mp3
```

Linux/macOS：

```bash
.venv-tts/bin/python -m pip install edge-tts
.venv-tts/bin/python -m edge_tts --text "你好，大肥鱼" --write-media test.mp3
```

确认 `test.mp3` 能播放。用同一环境运行 `python -m edge_tts --list-voices` 可查看音色。

## 2. 配置 OpenClaw

在 OpenClaw 配置中**合并**下列内容，保留已有的 QQ 通道、其他插件和工具配置；不要用本示例覆盖整个配置文件。`python` 要改成虚拟环境 Python 的绝对路径，Windows 路径在 JSON 中要写成双反斜杠。可用工具列表如果已存在，请将工具名合并进去。

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": {
          "tts": {
            "enabled": true,
            "python": "/absolute/path/to/.venv-tts/bin/python",
            "voice": "zh-CN-XiaoxiaoNeural"
          }
        }
      }
    }
  },
  "tools": { "allow": ["fatfish_tts"] }
}
```

根据本机 OpenClaw 版本应用配置并检查 `openclaw plugins inspect fatfish --runtime --json`。语音合成会真实计费，因此和其它能力一样受权限控制：管理员默认可用，普通用户需要管理员执行 `/fish allow tts on` 才能触发；同一会话默认 30 秒内只能合成一次，可用 `tts.cooldownSeconds` 调整（设为 0 关闭限频）。在可信的私聊中请求机器人把一句话转成语音，检查是否产生音频并能够通过通道发送。当前版本未经过真实 QQ 端到端验证；若通道不支持 MP3 或语音发送，需由通道侧适配，不能保证自动转换。

## 3. 关闭和排错

- 将 `tts.enabled` 设为 `false`，或从允许的工具中移除 `fatfish_tts`。
- 找不到 Python：填写运行 Gateway 的机器上 Python 可执行文件的绝对路径。
- 提示缺少 `edge_tts`：用同一个 Python 路径安装依赖。
- 合成失败：先运行上面的独立测试，检查网络、音色和上游服务状态。
- 合成成功但无法发送：检查 OpenClaw 的媒体访问权限、QQ 通道对音频的支持以及运行环境的文件路径。

音频保存在运行 Gateway 的系统临时目录 `openclaw-fatfish` 中；下次生成时会尝试清理本插件创建的、超过 24 小时的文件。若不再使用插件，请自行删除该目录。插件不保证定时清理。
