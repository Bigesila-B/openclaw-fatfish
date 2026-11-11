# 从纯净 OpenClaw 配置 QQ 机器人（实验性）

本向导目标是带你从已经安装的 OpenClaw 出发，逐步配置模型、连接 QQ，并选择需要的功能。当前向导仍为 Alpha：已经用隔离配置和模拟端口测试配置写入，尚未用真实 QQ 完成端到端测试。

向导第一步会让你选择接入方式：

- **1 = QQ 开放平台官方机器人（推荐）**：不用装 SnowLuma、不用扫码，需要 AppID / AppSecret。细节见[官方机器人接入](qqbot.md)。
- **2 = SnowLuma OneBot**：需要另一台能跑 SnowLuma 并扫码登录的机器，下文按这条路径展开。

## ⚠️ 为什么“装了却用不了”

插件的 7 个工具都是**可选工具**，OpenClaw 默认不会把它们暴露给模型。不配置这一步时，只有 `/fish` 指令能用，AI 本身不知道有生图、解析这些能力。

向导会询问“是否把大肥鱼的功能注册给模型”，回答 `y` 即可写入：

```json5
{ tools: { alsoAllow: ["fatfish"] } }
```

手改配置后必须重启 Gateway。详见[官方机器人接入](qqbot.md#第三步让模型能看见大肥鱼的工具关键)。

## 开始之前

1. 安装并能运行 [OpenClaw](https://docs.openclaw.ai/start/getting-started)。本地模拟测试使用 OpenClaw 2026.6.35 和 Node.js 24.22.1，其他版本尚未验证。
2. 准备一台能运行 QQ 和 SnowLuma 的机器，根据 [SnowLuma 快速开始](https://snowluma.github.io/zh/docs/guide/quickstart)安装并使用手机扫码登录。无法用本插件绕过扫码。
3. 在 SnowLuma 中启用 OneBot WebSocket，记下地址和访问令牌。向导只测试 TCP 端口连通，不能确认登录状态和令牌是否正确。
4. 需有一个聊天模型；向导可打开 OpenClaw 自带模型配置向导。具体模型是否免费、是否需要账号由服务商决定。

## 安装并启动向导

在有交互终端的环境执行：

```bash
openclaw plugins install git:github.com/Bigesila-B/openclaw-fatfish@main
openclaw plugins enable fatfish
openclaw fatfish setup
```

### 先装 SnowLuma（可选，自动下载）

```bash
openclaw fatfish install-snowluma
openclaw fatfish install-snowluma --dir /opt/snowluma/app   # 指定目录
```

安装器按 **官方仓库 → 备用 fork → 配置里的镜像** 顺序查找 Release，只接受与当前平台/架构匹配的非 lite 包，下载后用 `checksums.sha256` 校验 sha256，再解压到临时目录验证启动脚本，成功后才替换现有安装。校验失败或包内路径可疑（绝对路径、`..`）会直接中止并保留旧版本。

仓库顺序可用 `snowluma.sources` 覆盖（数组，元素形如 `owner/repo`），安装目录用 `snowluma.installDir` 固定。官方仓库已不可访问时，请确认备用 fork 是否上传了 Release 资产——**GitHub 的 fork 不会继承 Release**。

安装完成后运行安装目录里的 `launcher.sh`（Windows 为 `launcher.bat`），WebUI 默认在 `http://127.0.0.1:5099`。

安装前先审阅并信任代码。`main` 会变动；需要可复现安装时请换成审阅过的提交。若非交互安装提示第三方来源，检查来源后按 OpenClaw 提示操作。

## 向导会做什么

1. 询问是否打开 OpenClaw 模型配置向导。已配置模型可以跳过；不会自动验证模型可用性。
2. 引导安装 SnowLuma 和扫码登录，询问 OneBot WebSocket 地址、令牌、管理员 QQ 号和群号。**群号留空表示不限制来源**：任何人都能私聊机器人，群里 @ 也能触发；填写群号后，通道只放行管理员私聊和这些群。真正的功能权限仍由 `admins` 和 `/fish allow` 控制，不受这里影响。
3. 测试端口是否可连接。OpenClaw 在容器中时，`127.0.0.1` 指容器自己；远程未加密 `ws://` 不适合不可信网络。
4. 如未安装，询问是否安装第三方 [openclaw-snowluma](https://github.com/t871631092/openclaw-snowluma) `0.9.0` 通道插件；如果已安装但关闭，会询问是否启用。安装可能修改 OpenClaw 的插件配置。
5. 可选配置人格；TTS、生图和视频暂时通过各自教程另行配置。STT 已提供硅基流动接口（见[云模型教程](cloud-providers.md)第 5 节），但 QQ 语音输入链路尚未接通，配置 STT 不等于 QQ 语音已可自动识别。个人 QQ 令牌以隐藏方式输入，随后保存在 OpenClaw 配置文件中，应妥善保护该文件。
6. 显示将更改的项目，经确认后先通过 OpenClaw 预检，再合并写入配置，之后检查通道插件能否加载。保留其他通道和模型；会覆盖同名 SnowLuma 地址、令牌、`allowFrom` 以及大肥鱼的管理员列表。群号留空会删除旧 `allowFrom`，恢复不限制来源。选择“注册工具”时，读取原有 `tools.alsoAllow`，保留其他插件并追加 `fatfish`；读取失败则停止，不覆盖原设置。选择人格时还会设置提示钩子权限。写入后自动运行配置诊断。
7. 可选择前台启动 Gateway。请保持终端打开，用管理员 QQ 私聊机器人发送测试消息；已有运行中的 Gateway 请按实际部署方式重启或重载。向导完成只表示配置写入，不证明 QQ 已连接或成功回复。

重复运行会重新填写上述字段，特别是 `allowFrom` 和管理员列表会整体替换，请在确认页面核对。已经通过 QQ 保存的人格设置优先于向导新写入的默认人格，可以通过 `/fish persona reset` 恢复配置文件中的人格。

后续可随时运行 `openclaw fatfish doctor` 查看缺少的管理员、默认模型、工具开放、凭据或本机依赖。诊断不调用模型、不显示密钥；QQ 在线、模型真实回复和媒体格式兼容性仍需实际测试。

## 后续功能

- [配置管理员及生图/视频权限](permissions.md)
- [配置人格](persona.md)
- [TTS 语音合成](tts.md)
- [本机 ComfyUI 生图及视频](comfyui.md)
- [QQ 黑名单](blacklist.md)

## 排错

- 向导找不到：确认插件已安装、启用，并重新打开终端；运行 `openclaw plugins inspect fatfish --runtime --json` 检查。
- 端口不可连接：确认 SnowLuma 已启动、OneBot 端口正确、容器/防火墙配置正确。
- 写入预检失败：确认 SnowLuma 通道插件安装成功，再运行 `openclaw config validate`；避免把访问令牌贴到公开日志中。
- 配置完成却不回复：检查 Gateway 日志、SnowLuma 登录状态、地址和令牌、模型可用性、允许列表及群聊 @ 规则。
- 群里 @ 了但完全没反应：先查 `channels.snowluma.allowFrom`。这项**未设置表示允许所有来源**；一旦设置，就只放行列表内的 `private:<QQ>` 和 `group:<群号>`，被挡掉的消息在 Gateway 日志里没有任何记录。手改配置或旧版向导容易留下只含管理员私聊的白名单，把群全挡在外面。
- `/fish` 指令能用，但让 AI 生图/解析时它说做不到：这是可选工具没启用，不是权限问题。检查 `tools.alsoAllow` 里是否有 `fatfish`（或具体工具名），改完重启 Gateway。
- 提示“身份不可验证”：核对 `plugins.entries.fatfish.config.admins`。SnowLuma 填 QQ 号，官方机器人填 openid，填错类型会被当作无效身份。
- 插件尚未提供自动安装 QQ/SnowLuma、自动扫码、自动验证真实消息或图形化安装器；本向导不会假称这些步骤已经完成。
