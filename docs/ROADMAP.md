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

## 测试策略

- `test/index.test.js` 通过 Node 的模块解析钩子把 `openclaw/plugin-sdk/*` 替换成本地桩，用来执行并断言插件装配逻辑。
- 因此它验证的是“给定 SDK 行为时的装配是否正确”，不能替代真实运行时验证。真实加载验证见上面的记录表。
- 其余测试直接测模块本身，不依赖 OpenClaw。

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
