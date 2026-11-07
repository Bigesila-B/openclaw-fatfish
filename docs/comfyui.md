# 本机 ComfyUI 生图与生视频（实验性）

支持本机 ComfyUI API 工作流，将用户文字写入管理员指定的一个文本输入节点。插件不包含模型、工作流、自定义节点或 ComfyUI；请先自行安装。无需付费 API 的本地模型需要对应硬件和电力，还要遵守模型许可。ComfyUI 工作流也可能包含收费云端节点，启用前请自行检查工作流。

## 1. 准备工作流

1. 在运行 OpenClaw Gateway 的同一网络命名空间启动 [ComfyUI](https://docs.comfy.org/)；本版本仅支持 `http://127.0.0.1:8188` 这类本机 HTTP 地址。如果 OpenClaw 在容器中，容器内的 127.0.0.1 不是宿主机。
2. 在 ComfyUI 选择和安装合适的本地图片或视频模型，准备文本生成工作流，先在 ComfyUI 界面手动测试成功。确保保存输出文件，图片使用 PNG/JPEG/WebP，视频使用 MP4/WebM；视频节点的输出结构必须包含 `images`、`gifs` 或 `videos` 文件列表。
3. 导出 **API 格式**的工作流 JSON（不是普通画布工作流格式），保存到 Gateway 可以读取的绝对路径。新版界面中导出入口名称可能因版本变化；参阅 [ComfyUI 官方文档](https://docs.comfy.org/development/comfyui-server/comms_routes)。
4. 打开 API JSON，找到提示词节点编号及其字符串输入名（常见为 `text`），再找到保存结果的输出节点编号。节点编号因工作流不同而不同；不要直接照搬下方示例。只使用自己信任的工作流和节点。

## 2. 配置 OpenClaw

先按 [管理员教程](permissions.md)配置 QQ 号。将需要的功能合并到 `plugins.entries.fatfish.config`，并将所需工具合并到已有 `tools.allow`：

```json
{
  "plugins": {
    "entries": {
      "fatfish": {
        "enabled": true,
        "config": {
          "admins": ["123456789"],
          "image": {
            "enabled": true,
            "url": "http://127.0.0.1:8188",
            "workflowPath": "/absolute/path/to/image-api.json",
            "promptNode": "6",
            "promptInput": "text",
            "outputNode": "9",
            "timeoutSeconds": 120
          },
          "video": {
            "enabled": false,
            "url": "http://127.0.0.1:8188",
            "workflowPath": "/absolute/path/to/video-api.json",
            "promptNode": "6",
            "promptInput": "text",
            "outputNode": "9",
            "timeoutSeconds": 600
          }
        }
      }
    }
  },
  "tools": { "allow": ["fatfish_generate_image", "fatfish_generate_video"] }
}
```

所有路径、节点 ID 都必须按实际环境替换；Windows JSON 路径中的反斜杠需要写成 `\\`。不需要视频就保留 `video.enabled: false`，也可以不配置它。`tools.allow` 是额外的 OpenClaw 授权，不能替代 QQ 权限。检查 `openclaw plugins inspect fatfish --runtime --json` 并按提示应用配置。

## 3. 测试与授权

管理员先尝试 `/fish image 一条大肥鱼`；也可要求机器人“帮我画一条大肥鱼”，让模型自行选择调用生图工具。视频分别使用 `/fish video ...` 或自然语言。自然语言调用取决于当前聊天模型具备工具调用能力，且已允许本插件工具。自然语言和命令均按实际请求者检查权限。QQ 通道能否接收命令、识别请求者和发送媒体必须在你的环境验证。

管理员通过 `/fish allow image on` 和 `/fish allow video on` 分别开放给普通用户；关闭时用 `off`。开启权限不代表工作流已经配置成功。

## 限制与排错

- 尚未接入云端供应商，也未在真实 ComfyUI / QQ 环境做端到端测试；部分视频节点可能使用不同输出结构而不可用。
- 工作流超时后 ComfyUI 的任务可能仍在运行，不会自动取消，也没有持久任务队列或自动重发，避免直接重复提交。当前同一插件实例仅允许一个生成请求运行，但超时后服务端可能继续运行。
- 输出上限 50 MB，保存到 Gateway 的系统临时目录 `openclaw-fatfish-generated`，目前需要管理员自行定期清理；QQ 对媒体格式和大小的要求也可能不同。
- 检查 ComfyUI 是否与 Gateway 同机、API JSON 是否有效、节点 ID 是否匹配、输出是否保存到 `output`。生成成功但没有发出时，检查 OpenClaw 和 QQ 通道的媒体访问及格式支持。
