# 路线与验证记录

本文件把“已验证”和“未验证”分开记录，避免把模拟测试或单机加载说成端到端可用。

## 验证记录

| 日期 | 环境 | 验证项 | 结果 |
|---|---|---|---|
| 2026-11-10 | Windows / Node 22.22.2 | `npm test` | 50 个用例：48 通过、2 跳过、0 失败 |
| 2026-11-10 | Omarchy Linux / Node 24.22.1 | `npm test` | 同上 |
| 2026-11-10 | OpenClaw 2026.11.2，`--dev` 隔离 profile | `plugins install --link` + `inspect --runtime` | `status=loaded`；6 个工具、`fish` 命令、`setup`/`install-video-skill`/`sticker` 子命令均已注册 |
| 2026-11-10 | 同上 | `config validate` 与非法 `admins` 配置 | 合法配置通过；非法 QQ 号被 configSchema 拒绝 |
| 2026-11-10 | 同上 | `openclaw fatfish install-video-skill` | 从上游仓库安装成功，记录到具体提交 |
| 2026-11-10 | SnowLuma v2.4.2 + QQ 3.34 + OpenClaw 2026.11.2 | 真实 QQ 私聊发送 `/fish help` | 机器人返回指令列表；SnowLuma 日志可见入站事件与出站引用回复，指令链路打通 |

复现方式（始终使用独立状态目录，不要直接改已有 QQ 配置）：

```bash
npm test
npm run check
openclaw --dev plugins install --link . --force --accept-capabilities
openclaw --dev plugins inspect fatfish --runtime --json
openclaw --dev config validate
```

`openclaw --profile <名字>` 也可以达到同样的隔离效果。用完可删除对应的 `~/.openclaw-<名字>` 目录。

## 仍未验证

以下项目需要真实 SnowLuma + QQ 环境，当前仓库里任何“已支持”的表述都应视为待验证：

- 模型回复：本次联调环境没有配置任何聊天模型，只验证了不经过模型的指令路径
- `before_dispatch` 钩子在真实消息上的触发行为
- 群聊消息收发，以及未 @ 机器人时能否观察到群消息
- 图片、音频、视频发送到 QQ 的成功率与格式兼容性
- 云端生成、语音服务的真实计费调用（当前测试全部使用桩响应）

## 运行时注意（2026-11-10 联调发现）

- **人格钩子默认被网关拦截。** 非内置插件必须显式配置 `plugins.entries.fatfish.hooks.allowConversationAccess=true`，否则启动日志会出现 `typed hook "before_prompt_build" blocked`，人格静默不生效。向导只在选择配置人格时写入该字段，手动改配置的人容易踩到。
- **`--dev` 必须写在子命令前。** `openclaw --dev gateway run` 使用隔离状态目录；写成 `openclaw gateway run --dev` 会指向主状态目录，并因另一个网关占用而启动失败。
- **同一状态目录只能有一个网关。** 重启前先停止旧进程，否则新进程只做参数校验就退出，旧进程仍在跑旧配置（配置热加载可能掩盖这一点）。
- **SnowLuma 必须在 QQ 登录前注入。** 先登录再注入会一直停在 `loggedIn=false`；QQ 启动后 1 秒内注入即可正常进入 `online`。
- **`channels.snowluma.allowFrom` 未设置 = 允许所有来源**，设置后只放行列表内的 `private:<QQ>` 与 `group:<群号>`，被挡的消息在 Gateway 日志里没有痕迹。群里 @ 没反应优先查这里，而不是先怀疑模型或黑名单。向导现在只在填写群号时才写入这项。

## 测试策略

- `test/index.test.js` 通过 Node 的模块解析钩子把 `openclaw/plugin-sdk/*` 替换成本地桩，用来执行并断言插件装配逻辑。
- 因此它验证的是“给定 SDK 行为时的装配是否正确”，不能替代真实运行时验证。真实加载验证见上面的记录表。
- 其余测试直接测模块本身，不依赖 OpenClaw。

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

- [ ] 抽象发送接口，带通道能力探测与失败回退
- [ ] 明确“工具返回文件路径”和“消息已发送”之间的边界，避免模型误报已发送
- [ ] 发送失败时给出可操作的错误，而不是静默丢弃

### 阶段 2：语音与视频附件桥接

- [ ] QQ 语音附件 → STT 链路
- [ ] QQ 视频附件 → 直链解析或明确的降级提示
- [ ] 附件大小、格式、超时的统一限制

### 阶段 3：群聊决策

- [ ] 先确认通道能否观察未 @ 的群消息
- [ ] 消息合并、上下文观察、按群频率控制
- [ ] 明确请求与管理指令不被闲聊频率误拦

### 阶段 4：状态面板与发布

- [ ] 按 [状态面板设计](status-panel.md) 实现 `/fish status`
- [ ] README 架构图与效果展示
- [ ] 打 tag、写 release 说明
