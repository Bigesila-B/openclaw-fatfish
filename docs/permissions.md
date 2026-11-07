# QQ 管理员与功能权限（实验性）

## 设置管理员

在运行 Gateway 的 OpenClaw 配置中，合并插件配置。QQ 号必须为字符串，不要填写昵称，也不要覆盖现有配置：

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": { "admins": ["123456789"] }
      }
    }
  }
}
```

替换为管理员本人 QQ 号，可配置多个。默认为空，没有默认管理员。保存后按 OpenClaw 的提示应用配置。SnowLuma 通道自己的用户白名单、命令授权、群聊触发规则仍然生效；插件的管理员设置不会绕过它们。

## QQ 中管理

经 SnowLuma 通道授权的管理员可在 QQ 发送：

```text
/fish permissions
/fish allow image on
/fish allow image off
/fish allow video on
/fish allow video off
/fish persona status
```

初始时普通用户的生图和视频权限均为关闭。开关适用于本插件所有 QQ 会话，并独立控制图片和视频；它们仅授予使用机会，还需功能已配置、启用且 OpenClaw 及通道允许调用。管理员默认可用已启用的功能。普通用户不能更改开关。插件只接受 OpenClaw 传递的 `snowluma` 通道和发送者 ID，缺少身份时拒绝，不能通过消息内容自称管理员。

变更保存在 OpenClaw 状态目录的 `fatfish/permissions.json`，重启保留。此 Alpha 暂不支持多个 Gateway 同时写入同一份文件、按群设置或按人设置额度。不要手动给予他人文件写权限。

管理员也可配置机器人的聊天人格，具体见[人格教程](persona.md)。

生图与视频的自然语言工具及 `/fish image`、`/fish video` 走同一权限检查；普通用户的权限在生成过程中被撤销时不返回生成结果。真正的 QQ 通道指令路由和发送者身份仍需在实际环境验证。若通道无法传递可信身份，相关请求将被拒绝；请勿通过关闭身份检查来绕过。
