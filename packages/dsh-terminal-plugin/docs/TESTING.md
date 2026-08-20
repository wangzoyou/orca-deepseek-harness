# 测试说明

当前源码包含 17 个自动测试，覆盖：

- 裸 `dsh`、官方命令转发、参数与首条 prompt 路由。
- 本地 `/approval`、`/rename` 与未知 Harness slash command 透传。
- 官方宿主 readiness line、CLI patch 参数和进程退出。
- HTTP-up / WebSocket-down envelope。
- assistant chunk 流式输出与最终 message 去重。
- token usage、`turn/end` 完成语义。
- 审批 replay 的稳定 `rpcId` 去重。
- Harness 问题在 `Ctrl+C` 后的 cancelled 响应。
- `dsh setup` 配置持久化、`DSH_HARNESS_ROOT` 定位。
- 从实际 `src/bin.js` 启动宿主、创建会话、读取 `/exit` 并干净退出的端到端 smoke。

运行：

```sh
npm run check
npm test
```

构建环境没有安装完整的官方 Harness 运行时，因此端到端测试使用严格按当前 Host API envelope 实现的本地 fixture server。RPC 方法、事件、审批、问题、模型目录和 readiness line 均按 `deepseek-ai/deepseek-harness` 当前源码对齐；发布或合入 fork 前，仍应在真实 checkout 上执行一次模型、工具审批和取消 smoke test。
