# 机器人聊天人格（实验性）

管理员可以配置机器人是谁、性格、口吻及习惯。人格只用于 SnowLuma QQ 聊天的模型提示，不更改聊天平台、管理员身份或生图/视频权限。模型是否严格遵守说话风格取决于所用模型和上下文，不保证每次效果一致。

## 1. 前提

已经安装并启用大肥鱼插件，配置 SnowLuma QQ 通道和[管理员 QQ 号](permissions.md)。该 QQ 号还必须通过 SnowLuma/OpenClaw 的通道命令授权。

本功能使用 OpenClaw 的 `before_prompt_build` 钩子。针对支持该设置的版本，须在 OpenClaw 配置中给大肥鱼启用相关钩子权限；它允许该插件接收聊天钩子的原始对话数据，本功能自身不读取或保存这些对话内容。保存前请审阅插件代码。`allowPromptModification` 为 `false` 时人格不会注入。

将下面内容**合并**进现有配置，不要覆盖原有模型、QQ、管理员和其他插件配置：

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true,
          "allowPromptModification": true
        },
        "config": {
          "admins": ["123456789"],
          "persona": {
            "enabled": true,
            "prompt": "你叫大肥鱼，性格温柔好奇，聊天自然简短，偶尔用轻松的语气吐槽。"
          }
        }
      }
    }
  }
}
```

把 `123456789` 改成你的 QQ 号，`prompt` 改成想要的人格。人格默认关闭；如果开启，描述不能为空，长度不超过 1500 个字符。按 OpenClaw 提示应用配置，并使用 `openclaw plugins inspect fatfish --runtime --json` 检查 `before_prompt_build` 是否已注册。注册成功不等于已验证实际聊天效果。

## 2. 在 QQ 调整

管理员通过已授权的 QQ 会话发送：

```text
/fish persona set 你叫大肥鱼，是一条活泼友好的小鱼，喜欢游戏和画画，说话简短自然。
/fish persona status
/fish persona off
/fish persona on
/fish persona reset
```

`set` 保存新描述并启用；`off` 暂停但保留描述；`on` 恢复已保存的描述；`status` 只报告开关和长度，不回显内容；`reset` 删除 QQ 修改记录，恢复配置文件中的默认值。状态保存在 OpenClaw 状态目录的 `fatfish/persona.json`，重启后保留。QQ 设置优先于配置文件，后续改配置文件不会覆盖已保存的 QQ 设置，除非执行 `reset`。

不要把密码或其他秘密写入人格描述。人格在每次适用的 QQ 聊天中会提交给使用的模型服务。普通用户、非 SnowLuma 通道和身份不可验证的请求不能更改人格。当前人格对所有 SnowLuma QQ 会话共用，不支持按群、按私聊单独配置。

## 3. 没有生效时

- 检查插件已启用、人格不是关闭状态、提示词非空。
- 检查 `allowConversationAccess` 和 `allowPromptModification`，以及插件检查结果中的钩子；某些运行模式可能不触发该钩子。
- 检查请求是否来自 SnowLuma；其他通道不会使用大肥鱼的人格。
- 如果在 QQ 中设置失败，确认管理员 QQ 号和 SnowLuma 的命令授权、@ 触发规则；斜杠指令在具体 QQ 通道中的表现尚未实机验证。
- 如果配置文件修改后不生效，先检查是否保存过 QQ 人格覆盖；`/fish persona reset` 会恢复配置文件内容。
- 人格只改变模型收到的表达偏好，不应把它作为权限或安全控制；生图与视频仍由插件独立检查用户身份。
