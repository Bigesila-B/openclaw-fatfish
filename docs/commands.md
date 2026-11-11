# 大肥鱼指令列表

在 QQ 私聊或已允许的群中发送 `/fish help` 或 `/fish`，机器人会返回当前已实现的 QQ 指令列表。发送者需要通过 QQ 通道（SnowLuma OneBot 或官方 QQBot）授权并能被识别；黑名单仍然生效。列表中列出管理员指令只是方便查阅，普通用户不能执行管理操作。功能需要先安装、启用并获得相应权限。

| QQ 指令 | 作用 | 权限 |
|---|---|---|
| `/fish` 或 `/fish help` | 查看本列表 | 已通过通道授权的用户 |
| `/fish whoami` | 查看当前通道、用户标识和会话 | 已通过通道授权的用户 |
| `/fish image 提示词` | 生成图片 | 管理员或已获授权的用户 |
| `/fish video 提示词` | 生成视频 | 管理员或已获授权的用户 |
| `/fish sticker 关键词` | 查找并发送表情包 | 管理员或已获授权的用户 |
| `/fish permissions` | 查看普通用户权限 | 管理员 |
| `/fish allow image\|video\|watch\|sticker\|tts\|parse on\|off` | 设置功能权限 | 管理员 |
| `/fish parse status\|on\|off` | 开关媒体解析 | 管理员 |
| `/fish persona status` | 查看人格状态 | 管理员 |
| `/fish persona set 人格描述` | 设置人格 | 管理员 |
| `/fish persona on\|off\|reset` | 启用、关闭或恢复人格 | 管理员 |
| `/fish blacklist list` | 查看黑名单；标识仅在管理员私聊显示 | 管理员 |
| `/fish blacklist add\|remove user\|group 标识` | 添加或移除黑名单用户/群 | 管理员 |

竖线表示从中选择一项，例如 `/fish allow image on`。看视频和语音使用自然语言请求；看视频需要视频文件直链。`/fish status` 状态面板尚未实现，不包含在指令列表中。

`/fish whoami` 是配置管理员的关键入口：SnowLuma 通道下返回 QQ 号，官方 QQBot 通道下返回 openid（官方机器人不下发 QQ 号）。把返回值填进 `plugins.entries.fatfish.config.admins` 才能使用管理指令。

配置和素材导入需要在 Gateway 的终端进行；可运行 `openclaw fatfish --help` 和 `openclaw fatfish sticker --help` 查看终端命令。QQ 命令收发仍需在真实通道环境验证。
