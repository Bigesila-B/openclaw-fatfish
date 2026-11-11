# 接入 QQ 开放平台官方机器人

本页说明如何把大肥鱼接到 **QQ 官方机器人**（[QQ 开放平台](https://q.qq.com)）上，而不是 SnowLuma + OneBot。

官方机器人由 OpenClaw 内建 `qqbot` 通道提供，不需要在本机跑 SnowLuma，也不需要扫码登录，但需要你有一个能创建机器人的 QQ 开放平台账号。

> 状态：代码层面已按官方通道的会话格式（`qqbot:c2c:<openid>`、`qqbot:group:<group_openid>`）完成适配并通过单元测试；**尚未在真实机器人上跑通全链路**。遇到问题请按文末排错逐项核对。

## 和 SnowLuma 的差别（先看这张表）

| 项目 | 官方 QQBot | SnowLuma（OneBot） |
|---|---|---|
| 身份标识 | **openid**，不是 QQ 号，且每个机器人各自一套 | QQ 号 |
| 获取身份 | 私聊发送 `/fish whoami` 或官方 `/bot-me` | 直接就是 QQ 号 |
| 登录方式 | AppID + AppSecret | 手机扫码 |
| 群聊触发 | 默认要 @，可配置为自主发言 | @ 触发 |
| 群号 | group openid（不是群号） | 真实群号 |
| 富媒体 | 支持，官方通道会自动分片上传 | 取决于 OneBot 实现 |
| 主动消息 | 受平台限制，以回复为主 | 通常可主动发 |
| 一个机器人 | 默认只有创建者能私聊 | 可被任意好友私聊 |

**最容易踩的坑**：官方机器人拿不到 QQ 号。所以 `admins` 里填 QQ 号不会生效，必须填 openid。

## 第一步：创建机器人

1. 电脑打开 <https://q.qq.com/qqbot/openclaw/login.html>，用手机 QQ 扫码登录。
2. 点“创建机器人”。创建成功后机器人会自动出现在你的 QQ 消息列表里。
3. 复制 **AppID** 和 **AppSecret**。

> AppSecret 不会明文保存，离开页面后只能重新生成。请先复制到安全的地方。

## 第二步：配置 OpenClaw 的 qqbot 通道

较新的 OpenClaw 已内建 qqbot 通道，无需额外安装插件。若你的版本较旧，可安装腾讯官方通道插件 `@tencent-connect/openclaw-qqbot`。

任选一种方式：

```bash
# 方式一：命令行写入
openclaw channels add --channel qqbot --token "AppID:AppSecret"
openclaw gateway restart
```

```json5
// 方式二：手改 ~/.openclaw/openclaw.json
{
  channels: {
    qqbot: {
      enabled: true,
      appId: "你的 AppID",
      clientSecret: "你的 AppSecret"
    }
  }
}
```

确认通道起来了：

```bash
openclaw channels list          # 应能看到 qqbot
openclaw gateway restart
```

## 第三步：让模型能看见大肥鱼的工具（关键）

这一步不做，你会觉得“插件装了但没用”。

大肥鱼的 9 个工具都是可选工具，OpenClaw **不会自动启用**。必须在工具允许列表里追加：

```json5
{
  tools: { alsoAllow: ["fatfish"] }
}
```

- 用 `alsoAllow` 而不是 `allow`：`allow` 是严格白名单模式，写错会把核心工具一起关掉；`alsoAllow` 是追加，安全。
- 只想开其中几项时，写具体工具名：`["fatfish_generate_image", "fatfish_parse_link"]`。
- 改完必须重启 Gateway，只重载插件不算。

不想手改可以让向导代劳：

```bash
openclaw fatfish setup     # 选 1（官方机器人），回答“是否把大肥鱼的功能注册给模型”时选 y
```

## 第四步：配置插件并取得 openid

最小配置：

```json5
{
  plugins: {
    entries: {
      fatfish: {
        enabled: true,
        config: {
          admins: []          // 先留空，拿到 openid 再填
        }
      }
    }
  }
}
```

重启 Gateway 后，在 QQ 里私聊机器人发送：

```
/fish whoami
```

会返回四行，例如：

```
通道：QQ 官方机器人（qqbot）
用户标识：A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6
会话：c2c:A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6
管理员：否
```

把“用户标识”这一串填进 `admins`，重启后 `管理员` 会变成“是”，管理指令（`/fish allow`、`/fish persona`、`/fish blacklist`）才可用。

> 官方通道插件另有 `/bot-me` 指令，返回的内容相同，二者都行。

## 群聊怎么开

官方机器人默认只在被 @ 时回应。相关配置都在 `channels.qqbot` 下：

```json5
{
  channels: {
    qqbot: {
      appId: "…",
      clientSecret: "…",
      defaultRequireMention: true,   // 群里必须 @ 才回应
      groupPolicy: "open",           // 允许所有群；也可用 allowlist
      accounts: {
        default: {
          groups: {
            "*": { toolPolicy: "full" }   // 群里放开工具；默认是 restricted
          }
        }
      }
    }
  }
}
```

两点注意：

- 群里的 `toolPolicy` 默认是 `restricted`，会限制敏感工具。要让大肥鱼在群里可用，通常需要给对应群设 `"full"`。
- 群标识是 **group openid**，不是群号。可以在群配置里用 `"*"` 通配先跑通，再按实际 openid 收窄。

群黑名单同理，`/fish blacklist add group <group_openid>`。

## 排错

按顺序核对，多数问题能定位到具体一层：

| 现象 | 排查方向 |
|---|---|
| QQ 里发消息完全没反应 | `openclaw channels list` 里 qqbot 是否在线；AppSecret 是否过期（重生成一次）；`openclaw gateway` 日志有没有 `[qqbot]` 前缀的记录 |
| 能聊天，但 `/fish` 没反应 | 先用 `/bot-me` 或 `/fish whoami` 试；若都不回，是命令没进 OpenClaw，检查 `channels.qqbot.allowFrom` / `dmPolicy` 是否把你自己挡在外面 |
| `/fish` 能用，但 AI 不会生图/解析 | 就是第三步没做：`tools.alsoAllow` 里没有 `fatfish` |
| 提示“身份不可验证” | `platform.channels` 是否包含 `qqbot`（默认包含）；`admins` 里是否误填了 QQ 号而不是 openid |
| 群里 @ 了不回应 | `requireMention`、`groupPolicy`、以及群是否被 `groupAllowFrom` 排除 |
| 图片/视频发不出去 | 群里 `toolPolicy` 是否为 `restricted`；官方平台对媒体大小有限制（图片 20MB / 视频 30MB / 文件 100MB） |

## 想同时接两种通道

可以。`platform.channels` 默认就是 `["snowluma", "qqbot"]`，两边的身份都会校验。同一个人在两种通道下标识不同，所以：

- `admins` 里可以同时写 QQ 号和 openid，两者互不影响。
- 权限（`/fish allow`）是全局的，两种通道共用一份。
- 黑名单条目也同时接受 QQ 号和 openid。

想只允许其中一种通道，把它改成单元素数组即可：

```json5
{ plugins: { entries: { fatfish: { config: { platform: { channels: ["qqbot"] } } } } } }
```
