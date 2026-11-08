# 可选功能：表情包（实验性）

表情包系统参考 [MaiBot 的表情包配置](https://docs.maibot.chat/manual/configuration/bot-config)：先管理图片及描述，再结合对话选择合适的图片。本插件当前采用管理员手动导入、关键词/标签检索和聊天模型选图；没有自动收集群友图片、自动识图标注、语义向量检索或复杂的自主聊天决策。

功能默认关闭，不附带表情包素材。仅导入你有权使用的图片。支持 PNG、JPEG、GIF、WebP，单张不超过 5 MB；以内容哈希去重，默认最多 64 张。动画 GIF 能否显示取决于 QQ 通道和客户端。

## 1. 导入表情

在运行 OpenClaw Gateway 的机器上，将表情文件放在管理员可访问的位置，执行：

```bash
openclaw fatfish sticker add /path/to/happy.png --description "笑得很开心的小鱼" --tags "开心,笑,高兴"
openclaw fatfish sticker list
```

Windows 请将路径换成本机实际文件，例如 `"C:\\images\\happy.png"`。描述最多 160 字，标签最多 10 个、每个最多 24 字；请根据图片实际含义填写，匹配依赖这些文字。第二条命令列出完整 ID、描述和标签。删除时使用完整 ID：

```bash
openclaw fatfish sticker remove 表情的完整ID
```

图片副本和索引保存在 Gateway 的 OpenClaw 状态目录 `fatfish/stickers/`；不要通过 QQ 把服务器路径提供给普通用户。图库容量满时需管理员删除或调整上限，不会自动覆盖旧表情。管理命令应由可信的本机管理员运行；多进程不要同时修改同一图库。

## 2. 启用功能

将以下内容**合并**到 OpenClaw 配置，保留已有配置、管理员和工具允许列表：

```json
{
  "plugins": {"entries": {"fatfish": {"enabled": true, "config": {
    "admins": ["123456789"],
    "stickers": {"enabled": true, "autoSuggest": false, "maxEntries": 64, "maxCandidates": 12, "cooldownSeconds": 60}
  }}}},
  "tools": {"allow": ["fatfish_sticker_search", "fatfish_sticker_select"]}
}
```

重启 Gateway。管理员可尝试 `/fish sticker 开心`；按标签或描述检索不到时不会随机发送。管理员通过 `/fish allow sticker on` 和 `/fish allow sticker off` 开放或关闭普通 QQ 用户权限，通过 `/fish permissions` 查看权限。普通用户默认不能用；管理员身份和消息授权必须能由 SnowLuma 可靠传递。

`autoSuggest: false` 时，提示聊天模型仅在用户明确提出表情包需求时查找；设为 `true` 后，模型可以在普通聊天中自行决定是否搜索和选择。模型仍可能不调用工具、选得不准确或发送失败。搜索和选择是两个可选工具：查找只返回描述，选择返回图片路径；模型还需要使用 OpenClaw 的消息工具发送到当前会话，插件不会因此声称发送已经成功。QQ 指令则通过通道的结构化媒体回复发送。图片发送受 OpenClaw 媒体访问和 SnowLuma 配置影响；本机文件路径必须能被允许访问，SnowLuma 和 Gateway 分机部署时尤其要检查路径共享。

`cooldownSeconds` 默认 60 秒，限制插件的选择/指令入口，按会话在当前 Gateway 进程内计时；重启会重置，不能约束其他插件或消息工具绕过本功能直接发送图片。可按环境调整，设为 0 时不限制。`maxCandidates` 限制提供给模型的候选数。关键词检索不是语义理解，描述不匹配时可能找不到图；模型负责在候选中判断是否合适。

## 3. 已知限制

- 尚未在真实 SnowLuma + QQ 环境验证完整的表情包收发、GIF 动画及文件路径访问。
- 不会自动读取或收集 QQ 聊天图片，也不会自动用视觉模型生成描述。这些能力需要进一步处理通道数据、收集范围、重复和隐私设置。
- 当前只借鉴 MaiBot 的图库与选图思路，不包含 MaiBot 的完整表情收集、识别、自动清理和群聊决策系统。
