# 设计说明

## 目标

这个包只负责“终端表层”，不重新实现 Agent、工具、认证、session persistence 或模型适配器。核心原则是：**Harness 是运行时，CLI 是客户端。**

旧式做法通常把模型循环和 UI 写在同一个进程里，一旦 Harness 内部插件图变化，整个 TUI 都会一起破。这里把兼容面压到两个位置：

1. `host-process.js`：启动官方 Web profile，并叠加一张很薄的 patch。
2. `rpc-client.js` / `session-controller.js`：适配公开给 Web 客户端使用的 RPC 与事件协议。

## 为什么复用 Web 宿主

Headless profile 是一次性任务表层，没有用户追问、审批、会话切换与持续事件流。ACP 则有意保持较小的互操作面，不覆盖完整 transcript、模型选择、标题、计划与工具展示。Web 宿主已经拥有终端需要的完整 Host API，因此复用它最稳。

`config/cli-surface.patch.yml` 只覆盖 `web-runtime`：

- 保留 URL readiness line，便于父进程发现随机端口。
- 设置 `surfaceContext: false`，避免系统提示误称用户正在浏览器页面中。
- 不改模型、工具、存储、权限和凭据插件。

## 进程模型

裸 `dsh` 的流程：

1. 解析 wrapper 参数。
2. 按 `DSH_OFFICIAL_BIN`、`dsh setup` 用户配置、`DSH_HARNESS_ROOT`、本地依赖、当前 checkout 和全局包目录的顺序定位官方 CLI。
3. 启动 `dsh web --patch ... --host 127.0.0.1 --port 0`。
4. 读取 `dsh web: http://127.0.0.1:<port>` readiness line。
5. 建立两条下行 WebSocket 与 HTTP 上行。
6. 创建或恢复 session，进入 readline composer。
7. 退出时先关闭输入与 RPC，再向官方宿主发送 SIGTERM；超时后才强制终止。

`dsh web`、`dsh plugin` 和所有以 `-` 开头的官方 launcher 参数不走这条路径，而是原样转发。

## 协议边界

上行 RPC：

```json
{
  "type": "client-request",
  "rpcId": "uuid",
  "method": "session.prompt",
  "payload": {}
}
```

下行 WebSocket：

```json
{
  "type": "server-request",
  "rpcId": "stable-or-push-id",
  "method": "session/event",
  "payload": {}
}
```

审批和问题不是普通 unary method。CLI 必须把下行 `rpcId` 原样带回 `/api/respond`，所以 `SessionController` 为每个 interaction 保存稳定 ID，并对重连 replay 去重。

## 会话事件折叠

每个 session 保存一个 `seenSeq`：

- `seq <= seenSeq`：重复事件，忽略。
- `seq == seenSeq + 1`：直接处理。
- `seq > seenSeq + 1`：先调用 `session.history` 补洞，再继续处理 live frame。
- WebSocket 重连后收到 `session/subscribed.lastSeq`，若它高于本地 watermark，也主动补历史。

这样终端不会因为瞬时断线漏掉 assistant chunk、tool result 或 `turn/end`。

## 流式文本

`assistant/chunk.text-delta` 立即写到 stdout；同一步最终到达 `assistant/message` 时，只用于完成 accounting 和历史一致性，不再次打印已经流式显示的正文。没有收到 text delta 的步骤才渲染最终 message。

Reasoning 文本默认不展开，只显示一次“思考中”提示，避免把模型私有思维或大段推理灌满终端。

## Ctrl+C 语义

- composer 正在等待输入：第一次中断当前输入并提示"再按一次 Ctrl+C 退出"（短窗口内有效，任意打字解除），第二次请求退出，走完整清理并关闭宿主。
- turn 正在运行，readline 空闲：调用 `session.cancel`。
- approval 正在询问：回传 `rejected`。
- question 正在询问：回传 `RpcResult` 的 `cancelled` 错误。
- SIGTERM：开始清理并关闭宿主。

## 权限

CLI 默认 `ask`，自动允许必须显式使用 `/approval allow` 或 `--approval allow`。这个状态只存在于当前进程，不写入 Harness 的 General settings。

## 非目标

- 不恢复已删除的旧 TUI 包。
- 不复制官方 OAuth。
- 不直接读写 Harness session 文件。
- 不依赖浏览器 DOM 或 Web 前端 bundle 的内部组件。
- 不把终端 UI 做成 alternate-screen 全屏应用。
