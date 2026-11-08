# 大肥鱼 OpenClaw QQ 伙伴

面向 SnowLuma 私人 QQ 号和 OpenClaw 的免费优先、按需启用的开源项目。

> **早期 Alpha：提供实验性的管理员权限、云端模型和本机 ComfyUI 接入。QQ 音频输入、媒体发送及视频生成尚未完成端到端验证；没有管理面板或 MaiBot 式自主聊天。尚未完成真实 ComfyUI + OpenClaw + SnowLuma + QQ 端到端验证，不建议作为稳定版使用。**

## 功能状态

| 功能 | 状态 | 说明 |
|---|---|---|
| 配置向导 | 实验性 | [从纯净 OpenClaw 配置 QQ 接入](docs/setup.md) |
| TTS / 音色克隆 | 实验性 | [MiMo 云端语音及克隆配置](docs/cloud-providers.md)，也可选 Edge TTS；默认关闭 |
| STT 语音识别 | 实验性 | 硅基流动接口已验证；QQ 语音输入链路尚未完成 |
| 生图 / 生视频 | 实验性 | [Agnes 云端模型](docs/cloud-providers.md)或[本机 ComfyUI](docs/comfyui.md)；视频服务曾返回繁忙，QQ 端到端未验证 |
| QQ 管理员 / 权限 | 实验性 | [配置 QQ 管理员与权限](docs/permissions.md)，需 QQ 通道传递可信发送者身份 |
| QQ 黑名单 | 实验性 | [屏蔽 QQ 用户和群](docs/blacklist.md)，需实际验证消息路由 |
| 聊天人格 | 实验性 | [配置人格和说话风格](docs/persona.md)，支持管理员在 QQ 中调整 |
| 自然群聊决策 / 管理面板 | 计划中 | 需要先验证 QQ 通道的群消息接入 |
| QQ 状态卡片 | 设计中 | [字段、指令和权限设计](docs/status-panel.md)，尚未实现 |

云端模型可能调整免费额度、限速和价格，请以服务商实时公告为准。Edge TTS 不需要本项目收取 API 费用，但使用的是在线服务，服务可能变化；本地模型也会产生设备和电力成本。模型文件须遵守各自许可，不会随本仓库发布。

## 前提

- 已安装 OpenClaw，版本需与插件 SDK 兼容；已用 OpenClaw 2026.6.35 和 Node.js 24.22.1 验证本地插件加载和模拟配置向导。请参考 [OpenClaw 文档](https://docs.openclaw.ai/plugins/building-plugins)。
- 需要安装 SnowLuma 并扫码登录；向导会引导安装社区 QQ 通道 [openclaw-snowluma](https://github.com/t871631092/openclaw-snowluma)。本插件本身不连接 QQ。
- MiMo TTS 需要网络和 API 密钥；Edge TTS 需要 Python 和网络。参见[云模型教程](docs/cloud-providers.md)和 [Edge 语音教程](docs/tts.md)。
- 目前 OpenClaw 的通道、音频发送和安装兼容性尚未在真实环境验证。音频能否作为 QQ 语音发送取决于通道实现和媒体策略。

## 从 GitHub 安装（实验性）

OpenClaw 2026.6.35 下已验证以下 GitHub 安装及插件检查；请先审阅本仓库代码，只安装你信任的插件：

```bash
openclaw plugins install git:github.com/Bigesila-B/openclaw-fatfish@main
openclaw plugins enable fatfish
openclaw fatfish setup
```

非交互环境可能需要按 OpenClaw 提示在安装时添加 `--force`。`main` 会变化；生产环境建议改用审阅过的固定提交。

### 本地开发安装

先将仓库下载到运行 OpenClaw 的机器，然后在该目录执行：

```bash
openclaw plugins install --link .
openclaw plugins enable fatfish
openclaw plugins inspect fatfish --runtime --json
```

本插件没有发布到 npm 或 ClawHub。向导会引导配置模型、QQ 通道和管理员，详见[配置向导教程](docs/setup.md)。真正的 QQ 登录、Gateway 收发及其他 OpenClaw 版本尚待验证；不要将以上步骤理解为经过端到端验证的一键安装。

参考 [云模型教程](docs/cloud-providers.md) 或 [Edge 语音教程](docs/tts.md) 启用可选工具。没有开启 TTS 时，插件不会调用语音服务。

## 路线与参与

请看 [架构与路线](docs/architecture.md)。运行 `npm test` 执行不依赖 QQ 或外部服务的测试。欢迎通过 GitHub 提交 Issue 或 Pull Request；不要提交真实 QQ 记录、访问令牌或服务商密钥。

本项目与 OpenClaw、SnowLuma、MaiBot、Microsoft 均无官方隶属关系。
