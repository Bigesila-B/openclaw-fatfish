# 大肥鱼指令列表

在 QQ 私聊或已允许的群中发送 `/fish help` 或 `/fish`，机器人会返回当前已实现的 QQ 指令列表。发送者需要通过 QQ 通道（SnowLuma OneBot 或官方 QQBot）授权并能被识别；黑名单仍然生效。列表中列出管理员指令只是方便查阅，普通用户不能执行管理操作。功能需要先安装、启用并获得相应权限。

| QQ 指令 | 作用 | 权限 |
|---|---|---|
| `/fish` 或 `/fish help` | 查看本列表 | 已通过通道授权的用户 |
| `/fish whoami` | 查看当前通道、用户标识和会话 | 已通过通道授权的用户 |
| `/fish status [image\|text]` | 查看图片面板或文字状态 | 完整信息仅管理员私聊；简报须另行开放 |
| `/fish tasks` | 查看当前会话中自己的任务 | 已通过通道授权的用户 |
| `/fish task 编号` | 查询任务状态 | 原用户及原会话 |
| `/fish task resume\|cancel\|send 编号` | 恢复查询、取消本地任务、重发结果 | 原用户及原会话；恢复/发送需仍有权限 |
| `/fish image 提示词` | 生成图片 | 管理员或已获授权的用户 |
| `/fish video 提示词` | 生成视频 | 管理员或已获授权的用户 |
| `/fish sticker 关键词` | 查找并发送表情包 | 管理员或已获授权的用户 |
| `/fish resend 编号 [file]` | 重发已有媒体；file 表示按附件发送 | 原请求用户、原会话，且仍具备对应功能权限 |
| `/fish permissions` | 查看普通用户权限 | 管理员 |
| `/fish panel settings` | 查看面板设置 | 管理员私聊 |
| `/fish panel on\|off\|image\|text` | 开关面板、设置默认格式 | 管理员私聊 |
| `/fish panel theme dark\|light` | 设置主题 | 管理员私聊 |
| `/fish panel public on\|off` | 开关普通用户功能简报 | 管理员私聊 |
| `/fish allow image\|video\|watch\|sticker\|tts\|parse\|stt on\|off` | 设置默认功能权限 | 管理员 |
| `/fish allow 功能 on\|off\|inherit user\|group 标识` | 设置独立规则或恢复继承 | 管理员；限当前通道与机器人账号 |
| `/fish parse status\|on\|off` | 开关媒体解析 | 管理员 |
| `/fish persona status` | 查看人格状态 | 管理员 |
| `/fish persona set 人格描述` | 设置人格 | 管理员 |
| `/fish persona on\|off\|reset` | 启用、关闭或恢复人格 | 管理员 |
| `/fish blacklist list` | 查看黑名单；标识仅在管理员私聊显示 | 管理员 |
| `/fish blacklist add\|remove user\|group 标识` | 添加或移除黑名单用户/群 | 管理员 |

竖线表示从中选择一项，例如 `/fish allow image on`。看视频和语音使用自然语言请求；附件要求宿主提供标准媒体事实，也可使用视频 HTTPS 文件直链。详见[状态面板](status-panel.md)、[任务队列](tasks.md)和[附件处理](attachments.md)。

`/fish whoami` 是配置管理员的关键入口：SnowLuma 通道下返回 QQ 号，官方 QQBot 通道下返回 openid（官方机器人不下发 QQ 号）。把返回值填进 `plugins.entries.fatfish.config.admins` 才能使用管理指令。

配置和素材导入需要在 Gateway 的终端进行；可运行 `openclaw fatfish --help` 和 `openclaw fatfish sticker --help` 查看终端命令。QQ 命令收发仍需在真实通道环境验证。

`openclaw fatfish doctor` 检查管理员、默认模型、工具开放、已启用功能的凭据及本机依赖。它不调用模型，也不把“已配置”当作“QQ 已在线”。

媒体发送只有取得通道消息回执才报告成功。失败提示会给出重发编号；网络异常可能发生在平台已经接收之后，因此先检查 QQ，再执行重发，避免重复。重发只使用已有结果，不重新生成；已确认发送成功的文件不会再次发送。服务重启后编号仍可使用，但缓存过期或远程地址失效后无法保证重发。`file` 仅请求通道按附件发送，是否支持仍取决于 QQ 通道。
