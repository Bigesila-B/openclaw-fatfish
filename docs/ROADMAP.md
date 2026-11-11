# 路线与验证记录

本文件把“已验证”和“未验证”分开记录，避免把模拟测试或单机加载说成端到端可用。

## 验证记录

| 日期 | 环境 | 验证项 | 结果 |
|---|---|---|---|
| 2026-11-11 | Windows / Node 24.14.0 / OpenClaw 2026.6.35 | alpha.17 隔离加载、配置校验及真实 CLI PNG 预览 | 插件 loaded，9 个工具；配置通过；面板中文、CPU/内存/磁盘/NVIDIA 数据可渲染，未连接 QQ |
| 2026-11-11 | Windows / Node 24.14.0 | alpha.17 安装包独立安装、原生/WASM PNG 与 FFmpeg 转码 | 字体/许可随包；安装后渲染通过；真实 FFmpeg 转为 16 kHz WAV，过长音频拒绝；无模型 API 调用 |
| 2026-11-10 | Windows / Node 22.22.2 | `npm test` | 50 个用例：48 通过、2 跳过、0 失败 |
| 2026-11-10 | Omarchy Linux / Node 24.22.1 | `npm test` | 同上 |
| 2026-11-10 | OpenClaw 2026.11.2，`--dev` 隔离 profile | `plugins install --link` + `inspect --runtime` | `status=loaded`；6 个工具、`fish` 命令、`setup`/`install-video-skill`/`sticker` 子命令均已注册 |
| 2026-11-10 | 同上 | `config validate` 与非法 `admins` 配置 | 合法配置通过；非法 QQ 号被 configSchema 拒绝 |
| 2026-11-10 | 同上 | `openclaw fatfish install-video-skill` | 从上游仓库安装成功，记录到具体提交 |
| 2026-11-10 | SnowLuma v2.4.2 + QQ 3.34 + OpenClaw 2026.11.2 | 真实 QQ 私聊发送 `/fish help` | 机器人返回指令列表；SnowLuma 日志可见入站事件与出站引用回复，指令链路打通 |
| 2026-11-11 | Windows / Node 22.22.2 | `npm test` | 91 个用例：89 通过、2 跳过、0 失败（新增官方 QQBot 通道、openid 身份、`tools.alsoAllow` 相关用例） |
| 2026-11-11 | Windows / Node 24.14.0 / OpenClaw 2026.6.35 | alpha.16 隔离安装、运行时检查、配置验证和 `fatfish doctor` | 插件 `loaded`，7 个工具已注册；诊断能启动并报告空配置缺项；未连接真实 QQ |
| 2026-11-11 | Windows / Node 24.14.0 | alpha.16 `npm test` 与 `npm run check` | 110 个用例：108 通过、2 跳过、0 失败；全部源码语法检查通过 |
| 2026-11-11 | GitHub 最新默认分支 | 看视频技能实际安装与解析 | 成功记录 `44be7e702255126432cbfcb018e2e4c112e27a0c`；未执行视频分析或付费模型调用 |

复现方式（始终使用独立状态目录，不要直接改已有 QQ 配置）：

```bash
npm test
npm run check
openclaw --dev plugins install --link .
openclaw --dev plugins inspect fatfish --runtime --json
openclaw --dev config validate
```

`openclaw --profile <名字>` 也可以达到同样的隔离效果。用完可删除对应的 `~/.openclaw-<名字>` 目录。

## 仍未验证

以下项目需要真实 QQ 通道环境，当前仓库里任何“已支持”的表述都应视为待验证：

- **官方 QQBot 全链路**：代码已按 `qqbot:c2c:<openid>` / `qqbot:group:<group_openid>` 完成适配并通过单元测试，但没有在真实机器人上跑通消息收发与媒体发送
- 模型回复：2026-11-10 的联调环境没有配置任何聊天模型，只验证了不经过模型的指令路径
- `before_dispatch` 钩子在真实消息上的触发行为
- 群聊消息收发，以及未 @ 机器人时能否观察到群消息
- 图片、音频、视频发送到 QQ 的成功率与格式兼容性
- 云端生成、语音服务的真实计费调用（当前测试全部使用桩响应）

## 运行时注意（2026-11-11 补充）

- **可选工具默认对模型不可见。** 插件 9 个工具都是 `optional: true`，OpenClaw 的规则是可选工具永不自动启用。必须写 `tools.alsoAllow: ["fatfish"]`（或具体工具名）并重启 Gateway，否则只有 `/fish` 指令能用，AI 完全不知道有生图、解析这些能力。这是“装了插件却用不了”的最常见原因。
- **官方 QQBot 拿不到 QQ 号。** 用户标识是 openid，`admins` 里填 QQ 号不会生效。用 `/fish whoami`（或官方 `/bot-me`）查询。
- **`tools.allow` 与 `tools.alsoAllow` 语义不同。** `allow` 是严格白名单模式，`alsoAllow` 是追加。本插件推荐 `alsoAllow`，避免误伤核心工具。

## 运行时注意（2026-11-10 联调发现）

- **人格钩子默认被网关拦截。** 非内置插件必须显式配置 `plugins.entries.fatfish.hooks.allowConversationAccess=true`，否则启动日志会出现 `typed hook "before_prompt_build" blocked`，人格静默不生效。alpha.17 向导默认启用只读用量观测的会话权限，选择人格时使用宿主默认的提示修改策略；旧手动配置需要自行补齐。
- **`--dev` 必须写在子命令前。** `openclaw --dev gateway run` 使用隔离状态目录；写成 `openclaw gateway run --dev` 会指向主状态目录，并因另一个网关占用而启动失败。
- **同一状态目录只能有一个网关。** 重启前先停止旧进程，否则新进程只做参数校验就退出，旧进程仍在跑旧配置（配置热加载可能掩盖这一点）。
- **SnowLuma 必须在 QQ 登录前注入。** 先登录再注入会一直停在 `loggedIn=false`；QQ 启动后 1 秒内注入即可正常进入 `online`。
- **`channels.snowluma.allowFrom` 未设置 = 允许所有来源**，设置后只放行列表内的 `private:<QQ>` 与 `group:<群号>`，被挡的消息在 Gateway 日志里没有痕迹。群里 @ 没反应优先查这里，而不是先怀疑模型或黑名单。向导现在只在填写群号时才写入这项。

## 测试策略

- `test/index.test.js` 通过 Node 的模块解析钩子把 `openclaw/plugin-sdk/*` 替换成本地桩，用来执行并断言插件装配逻辑。
- 因此它验证的是“给定 SDK 行为时的装配是否正确”，不能替代真实运行时验证。真实加载验证见上面的记录表。
- 其余测试直接测模块本身，不依赖 OpenClaw。

## 0.1.0-alpha.17

- 实现 PNG 状态面板：随包中文字体、本机/WASM 双渲染、同权限文字降级；管理员私聊完整状态、可选公开功能简报。
- 分离数据采集与布局，真实会话模型和上下文来源可降级；数字用量按账号及时区日/月汇总，明确不完整性，不把未知值填零。
- 新增持久生成任务队列、任务查询/取消/结果重发；Agnes 视频记录服务端编号，重启或超时只恢复原任务查询，未知提交不自动重提。
- 新增标准宿主媒体附件入口、显式 STT 工具和有界 FFmpeg 转码；附件隔离与权限重查，私有 SILK/旧通道缺少事实时明确降级。
- 新增默认关闭的群聊策略：去重、短期观察、消息合并、概率和冷却；旧通道 @ 信息缺失时兼容原路由。
- 新增按用户/群的功能规则、inherit 恢复继承，绑定通道与机器人账号；更新帮助和各模块教程。
- 依赖安装与打包现在包含渲染器、OFL 中文字体和许可；保留 Windows/Linux × Node 22/24 验证。

真实 QQ 图片/语音/视频发送、未 @ 群消息可见性、两种通道的附件事实和私有语音编码仍需要现场验证。以上实现不等同于这些项目已通过实机验收。多节点队列、长期记忆、主动资源告警不包含在本版本。

## 0.1.0-alpha.16

- 修复媒体下载并发串文件、缓存命中误报失败：独立任务目录、yt-dlp 完成清单、有效缓存复用、同链接请求合并、累计大小校验和失败清理；解析并发默认最多 2 个。
- 新增统一媒体发送适配层：生成前检查当前会话路由与发送能力，生图/视频/TTS/表情包/链接解析按通道回执报告结果，不再要求模型猜测文件路径或再次发送。
- 新增 `/fish resend 编号 [file]`：持久保存发送进度，绑定原用户、会话、机器人账号与线程；重启后可重发未确认的已有结果，跳过已确认成功的文件。未知结果不会自动重试，以免重复发送。
- 新增 `openclaw fatfish doctor`，向导写入后自动运行；仅检查配置、本机依赖和密钥是否存在，不调用计费模型，不证明 QQ 在线或 API 可用。
- 修复向导替换其他插件的 `tools.alsoAllow`、留空群号却保留旧 `allowFrom` 的问题。
- 看视频技能默认安装上游最新提交，验证后切换，失败保留旧版本；新增 `rollback-video-skill` 回退。保留子进程环境变量白名单。
- 缓存清理改由 Gateway 服务生命周期管理，避免插件注册时启动重复定时器；下载与发送期间提供进程内文件租约。
- 功能名称、权限标识与工具清单开始集中到功能注册表；语法检查自动遍历所有源码，CI 增加 Windows。

此版本当时待办中的任务队列、标准附件入口、状态面板与轻量群聊策略已在 alpha.17 实现。仍需真实 QQ 多媒体及编码兼容性验证。当前发送适配层使用宿主公开的 `api.runtime.channel.outbound.loadAdapter`，依据通道返回的消息编号确认，不能证明终端用户已经阅读；通道是否支持语音或附件由其实现决定。

## 0.1.0-alpha.15

- 新增官方 QQ 机器人（OpenClaw 内建 `qqbot` 通道）支持：`src/identity.js` 统一通道 ID、用户标识格式与会话解析
- 官方机器人的身份标识是 **openid**，`admins` 与黑名单同时接受 QQ 号与 openid；新增 `/fish whoami` 用于查询自己的标识
- 新增 `platform.channels` 配置（默认 `["snowluma", "qqbot"]`），通道不在列表内一律按身份不可验证处理
- 配置向导新增接入方式选择（1 = 官方机器人，2 = SnowLuma），并会询问是否写入 `tools.alsoAllow`
- 修复「装了插件但 AI 用不了功能」：文档与向导明确说明可选工具必须加入 `tools.alsoAllow` 才对模型可见
- 工具上下文的通道/发送者读取兼容 `nativeChannelId` 与 `deliveryContext`，避免官方通道下全部 fail-closed
- 新增 `docs/qqbot.md`

## 0.1.0-alpha.14

- 新增 `openclaw fatfish install-snowluma`：按「官方仓库 → 备用 fork → `snowluma.sources` 追加镜像」顺序解析 Release
- 只接受与平台/架构匹配的非 lite 包；下载后用 `checksums.sha256` 校验，校验失败或包内出现绝对路径/`..` 直接中止
- 先解压到临时目录验证启动脚本，成功后才替换现有安装，失败保留旧版本
- `docs/setup.md` 与 README 补充用法；注意 GitHub 的 fork 不继承 Release 资产

## 0.1.0-alpha.13

- 新增媒体链接解析（`fatfish_parse_link`）：链接识别 → yt-dlp 解析 → 下载 → 缓存
- `/fish parse status|on|off` 运行时开关，写入 `fatfish/parse.json` 并在重启后保留
- 新增 `parse` 权限位，普通用户需 `/fish allow parse on`
- 缓存清理：每小时检查一次，超过 `cacheTtlDays` 或 `cacheMaxMb` 时自动删除最旧文件，定时器 `unref`
- 只放行内置/管理员配置的域名，拒绝带凭据的 URL、直播和播放列表

> 实现说明：AstrBot 的 `astrbot_plugin_media_parser` 是 AGPLv3，直接移植会让本项目的 MIT 许可失效。这里保持独立实现，复用 yt-dlp（Unlicense）作为下载层。

## 0.1.0-alpha.12

- 向导不再默认写入 `allowFrom`：群号留空表示不限制来源，任何人都能私聊、群里 @ 也能触发；只有填写群号时才收窄为「管理员私聊 + 指定群」
- `docs/setup.md` 与排错清单补充 `allowFrom` 的判定规则：未设置=全放行，设置后列表外来源在网关日志里没有任何记录

## 2026-11-10 安全修复（0.1.0-alpha.11）

- 视频脚本子进程改为环境变量白名单，只透出当前配置 `keyEnv` 指定的那一个密钥，不再继承网关的 `AGNES_API_KEY`、`MIMO_API_KEY` 等凭据
- 视频引擎改为固定提交安装：`git fetch --depth 1 <commit>` 后核对 `rev-parse HEAD`，与固定值不一致直接拒绝
- 语音合成补上身份校验、`tts` 权限位（`/fish allow tts on|off`）和会话级限频（`tts.cooldownSeconds`，默认 30 秒）
- 黑名单命令路径统一读取 `conversationId ?? from`；被拦截时返回明确文案，不再返回空对象
- 表情包与语音合成共用同一份冷却实现，冷却键统一为会话，两个入口不能互相绕过
- 工具返回给模型的文本不再包含服务器绝对路径，路径只放在 `details` 字段
- Agnes 生视频在创建任务前校验 `allowedDownloadHosts`，避免扣费后丢弃结果；轮询遇到 4xx 立即失败

仍未处理：Agnes 返回远程 URL 而非本地文件、视频 SSRF 边界依赖 SDK、MiMo 克隆样本只校验扩展名、向导的 OpenClaw 入口识别过窄。

## 里程碑

### 阶段 0：可信度地基（已完成）

- [x] 补 `src/index.js` 装配测试：工具契约、权限门禁、钩子挂载、CLI 注册
- [x] 加 CI，固定 Node 22 与 24 两个版本
- [x] 修 `docs/setup.md` 中过期的“STT 尚未实现”描述

### 阶段 1：媒体发送适配层

- [x] 抽象发送接口，生成前检查路由与通道发送能力，支持显式按附件重发
- [x] 明确“结果已准备”和“取得通道发送回执”之间的边界，避免模型误报已发送
- [x] 发送失败时提供重发编号，保留发送进度
- [ ] 真实 QQ 格式兼容性、自动转码与回执验证

### 阶段 2：语音与视频附件桥接

- [x] 标准宿主语音附件 → FFmpeg → STT 工具；真实 QQ SILK 仍待通道联调
- [x] 标准宿主视频附件 → 视频理解；旧通道提供明确降级提示
- [x] 附件大小、格式、超时及用户/会话/账号隔离

### 阶段 3：群聊决策

- [ ] 先确认通道能否观察未 @ 的群消息
- [x] 默认关闭的消息合并、两分钟内存观察、按群频率控制
- [x] 明确请求、@ 与管理指令不被闲聊频率误拦；旧通道缺少 @ 事实时保留宿主路由

### 阶段 4：状态面板与发布

- [x] 按 [状态面板](status-panel.md) 实现 `/fish status`，图片/文字与权限降级
- [x] README 模块图与本机 PNG 预览命令
- [ ] 打 tag、写 release 说明
