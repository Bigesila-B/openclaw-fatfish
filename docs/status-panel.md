# QQ 状态面板

alpha.17 起提供真实 PNG 卡片，无需浏览器、Chromium 或 Python。默认使用本机 resvg；无法加载本机组件时自动切换 WASM。随包分发 OFL 中文字体，Linux 缺少系统中文字体也可以渲染。通道无法确认图片送达或渲染失败时，用同一份经过权限过滤的数据回复文字。

## 在 QQ 使用

管理员私聊发送 `/fish status`，也可指定 `/fish status image` 或 `/fish status text`。管理员设置见[管理员与权限](permissions.md)。查询不调用模型或生成 API，默认冷却 10 秒。

管理员可在私聊调整并保存设置：

```text
/fish panel settings
/fish panel on
/fish panel image
/fish panel theme light
/fish panel public on
```

`on/off` 控制面板，`image/text` 控制默认格式，主题支持 `dark/light`。普通用户及群聊默认无法查看完整面板；`public on` 只开放功能开关简报。即使管理员在群里查询，也不展示模型、用量或主机信息。`public off` 关闭简报。黑名单与通道授权仍优先执行。

## 数据含义

| 区域 | 数据来源与限制 |
|---|---|
| 当前模型 | 优先读取当前会话模型；旧宿主不能读取时，显示该会话最近一次被插件观测的模型并注明来源。没有快照时显示不可用，不用默认模型冒充当前模型。 |
| 上下文 | 使用 OpenClaw 标记为新鲜的会话 token 快照，或回复事件明确给出的上下文占用。累计输入输出用量不能代表上下文占用。 |
| 今日 / 本月 token | 当前通道和机器人账号下已观测 LLM 调用；自然日和自然月，默认 `Asia/Macau`。只保存输入、输出、缓存和总量数字及模型元数据，不保存提示词或回复。安装前、钩子受限、遗漏事件及供应商账单不在保证范围内。没有观测值时不填零。 |
| 主机 | CPU 采样、内存、状态目录所在磁盘；NVIDIA GPU 经 `nvidia-smi` 读取，其他 GPU 或无权限时降级。容器显示进程可见系统，不保证是物理宿主机或容器配额。 |
| 功能 | TTS、STT、生图、生视频、看视频、表情包、链接解析的开关、所需环境凭据及最近调用结果。已配置不等同于在线可用，不调用模型探活。最近调用时间在文字版展示。 |
| 任务 | 当前机器人账号下排队、运行和待恢复数量。仅管理员私聊可见。 |

被动保存最近 45 天最多 20,000 条数字事件；达上限或缺失事件时统计可能不完整。命令本身没有 LLM 调用，不会更新当前模型快照。会话及账号使用哈希索引。用量钩子接触宿主事件，插件实现只落盘数字及必要元数据。

旧宿主 LLM 事件没有机器人账号时，只在内存暂存数字，等待回复事件携带同一会话和 runId 的精确账号关联；关联缺失或重启会遗漏该次统计，不会把多个机器人混记到默认账号。

## 配置与预览

把以下片段合并到 OpenClaw 配置，保留已有模型、通道和插件设置：

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "hooks": {"allowConversationAccess": true},
        "config": {
          "status": {
            "enabled": true,
            "format": "image",
            "theme": "dark",
            "engine": "auto",
            "publicSummary": false,
            "captureUsage": true,
            "timeZone": "Asia/Macau",
            "cooldownSeconds": 10,
            "gpu": true
          }
        }
      }
    }
  }
}
```

向导会写入只读用量观测所需的 `allowConversationAccess`。已有手动配置需补上并重启 Gateway，否则模型与 token 可能不可用。关闭 `captureUsage` 停用数字观测，不删除此前记录。`diskPath` 可指定另一挂载盘，`fontPath` 可指定自备字体；路径不能由 QQ 用户决定。`engine` 支持 `auto/native/wasm`。无效时区退回 `Asia/Macau`。

终端运行 `openclaw fatfish panel-preview --output /absolute/path/panel.png` 可生成当前机器的预览；未绑定 QQ 会话的模型与 token 显示不可用。预览不发到 QQ；不要把私人主机指标提交公共仓库。

## 扩展方式

`src/status/usage.js` 负责数字观测，`metrics.js` 采集主机，`render.js` 生成 SVG/PNG 和文字，`index.js` 处理权限、设置与发送。新功能在 `src/capabilities.js` 登记后进入功能状态区。

内部模块可调用 `statusService.registerCollector('queue-latency', async ({ctx, options}) => '120 ms')` 添加管理员扩展行；最多 8 个采集器，各自超时与失败降级，公共简报不执行它们。不得返回密钥、路径或用户正文。这是受信代码扩展点，不是允许聊天模型执行代码的接口。

PNG 沿用统一媒体发送层及消息回执；取得回执不代表用户已读。真实 SnowLuma / QQBot 图片显示仍需实际通道验证。
