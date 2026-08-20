# dsh-terminal-plugin

[![CI](https://github.com/P-A-N-52/dsh-terminal-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/P-A-N-52/dsh-terminal-plugin/actions/workflows/ci.yml)

一个面向 **DeepSeek Harness** 的非官方终端前门。全局安装后，在 Bash、Zsh 或 PowerShell 里直接输入：

```sh
dsh
```

就会进入类似 Kimi Code、Pi、Codex 的滚动式交互 CLI：持久会话、流式回答、工具调用卡片、权限审批、模型与推理档位切换、历史恢复、分叉和 `Ctrl+C` 取消都走 Harness 自己的运行时与会话协议。

它不是另起炉灶的 Agent，也不会复制 DeepSeek 的登录或凭据逻辑。CLI 在本机启动官方 `dsh web` 宿主，关闭错误的“浏览器表层上下文”，然后通过官方的 localhost HTTP/WebSocket API 连接。

## 安装

要求：

- Node.js 22.19+，或 Node.js 24+
- npm
- macOS、Linux 或 Windows

从本地压缩包安装：

```sh
npm install -g ./dsh-terminal-plugin-0.1.0.tgz
```

本插件不捆绑整个 Harness。安装后，把它指向已经构建的官方源码 checkout：

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm run build
dsh setup /path/to/deepseek-harness
```

之后在任意项目目录、任意 Bash / Zsh / PowerShell 中直接运行：

```sh
dsh
```

npm 会为 Unix shell 创建 `dsh` 可执行链接，并在 Windows 创建 `dsh.cmd` 与 `dsh.ps1`。若 PowerShell 的执行策略阻止 `.ps1` shim，可以先运行 `dsh.cmd`；这不影响 Bash、Zsh 或 Git Bash。

本包精确适配 `@deepseek-ai/dsh@0.1.0-rc.5`，但不把庞大的 Harness 运行时复制进插件。`dsh setup` 会使用你的本地构建；也可以不写配置文件，直接指定：

```sh
export DSH_OFFICIAL_BIN=/absolute/path/to/deepseek-harness/apps/cli/lib/bin.js
```

PowerShell：

```powershell
$env:DSH_OFFICIAL_BIN = 'C:\path\to\deepseek-harness\apps\cli\lib\bin.js'
```

`DSH_OFFICIAL_BIN` 应指向构建后的 `lib/bin.js`，不要指向尚未编译的 TypeScript 入口。找不到任何官方 CLI 时，交互终端会询问是否自动执行 `npm install -g @deepseek-ai/dsh` 并把结果固定到用户配置——确认之后启动就再没有任何设置步骤。

## 常用方式

```sh
# 进入交互 CLI；新会话使用当前目录
dsh

# 立即提交第一条任务
dsh "检查这个仓库，修复测试失败"

# 显式选择 CLI 参数
dsh cli --cwd ./project --model deepseek/deepseek-chat

# 恢复持久会话
dsh cli --resume <session-id>

# 连接已运行的本地 Harness Web 宿主
dsh cli --connect http://127.0.0.1:3080

# 使用 Code Mode 工具呈现
dsh cli --tools-mode code
```

原来的官方命令仍然可用，wrapper 会原样转发：

```sh
dsh web
dsh web --port 8080
dsh --profile headless "run the tests"
dsh plugin --profile web update
dsh official --profile web --dump-config

# 查看或重设本地 Harness 路径
dsh setup
dsh setup /path/to/deepseek-harness
dsh setup --clear
```

## 终端内命令

输入 `/` 立即唤起命令候选（本地命令 + Harness 原生命令），`Tab` 补全命令名与参数（模型、推理档位、权限预设、Agent 预设、会话 ID 等）。

```text
/help                         显示帮助
/new [目录]                   创建新会话；无参时从工作区选择
/sessions                     列出会话
/resume [会话ID或前缀]        恢复会话
/model [provider/model]       查看或切换模型
/reasoning [档位]             切换当前模型的推理档位
/permission [预设]            切换会话权限预设（沙箱+审批，同 Web UI 下拉；回合运行中也可切换）
/preset [id]                  查看或切换 Agent 预设（仅空白会话可切）
/rename <标题>                重命名会话
/fork                         从最近完整回合分叉
/approval ask|allow|deny      本 CLI 如何应答审批询问（不改会话权限）
/usage                        token 用量与上下文拆解
/search <关键词>              全文搜索会话并恢复命中（需部署开启会话索引）
/export [会话ID]              导出会话日志 ZIP 到当前目录
/jobs                         显示当前会话的后台任务
/agents                       列出当前会话的子代理（只读）
/queue [remove|steer|edit] …  查看或管理排队消息
/feedback up|down [备注]      给最近一条回复打分（👍/👎）
/archive [会话ID]             归档会话，从列表移除（不删数据）
/skill [名称] [参数]          列出或调用技能（skill）
/verbose on|off               展开或折叠工具输出
/debug on|off                 显示协议调试信息
/status                       显示当前状态
/version                      显示 CLI 与宿主版本
/cancel                       取消当前回合
/clear                        清屏
/exit                         退出
```

Harness 原生命令（`/plan`、`/compact`、`/goal`、`/swarm` 等）通过命令注册表执行并回显结果；真正未知的斜杠输入（如 skill 命令）才会作为消息发给模型。多行输入时，在行尾写一个反斜杠 `\` 继续下一行。

## CLI 参数

```text
--connect <url>               连接已有宿主，不启动子进程
--resume <session-id>         恢复指定会话
--cwd <path>                  新会话工作目录
--agent-preset <id>           创建会话时使用指定 preset
--model <provider/model>      启动后选择模型
--reasoning <level>           配合 --model 选择推理档位
--approval ask|allow|deny     审批策略，默认 ask
--tools-mode native|code|both 官方 DSH_TOOLS_MODE
--no-history                  恢复时不打印最近历史
--verbose                     展开工具结果
--debug                       打印协议调试信息
--host-log                    显示后台 Harness 日志
```

## 交互与安全边界

默认行为比较克制：

- 自动启动的宿主只绑定 `127.0.0.1`，不会暴露到局域网。
- 默认审批策略为 `ask`，每次危险工具操作都询问。
- `allow` 只影响当前 CLI 进程，不会改写 Harness 的持久权限设置。
- OAuth、API Key、模型提供方和 session persistence 继续由官方 Harness 管理。
- `Ctrl+C` 在输入框中：第一次中断输入并提示"再按一次退出"（约 1.5 秒窗口内有效，继续打字自动解除），第二次彻底退出 CLI 并关闭后台宿主；模型运行时按下调用 `session.cancel`；审批或提问中按下回传明确的拒绝/取消结果。

模型提供方尚未配置时，先运行 `dsh web`，在官方设置页完成配置，再回终端输入 `dsh`。

## 实现结构

```text
Bash / Zsh / PowerShell
          │
          ▼
  dsh-terminal-plugin
    ├─ 裸 dsh → 终端会话
    └─ 官方参数 → 转发 @deepseek-ai/dsh
          │
          ▼
官方 dsh web + cli-surface.patch.yml
  127.0.0.1 随机端口，surfaceContext=false
          │
          ├─ POST /api/session.*
          ├─ WS   /api/events.mux
          ├─ WS   /api/events.host
          └─ POST /api/respond
          │
          ▼
会话事件折叠、流式渲染、审批、问题、工具卡片
```

终端界面不使用 alternate screen，保留正常滚屏和 shell 历史，更接近 Codex/Kimi Code，而不是传统全屏 TUI。

详细设计见 [`docs/DESIGN.md`](docs/DESIGN.md)，接入现有 Harness fork 的方法见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。

## 当前限制

- 0.1 版仅处理文本输入；终端图片附件尚未接入。
- 设置、凭据编辑和模型提供方创建仍使用官方 Web UI。
- 回合运行中再发消息会作为 steering 消息注入（`session.prompt mode:'steer'`）；队列消息的编辑/删除（`session.updateQueue`）尚未接入。
- 会话全文搜索依赖部署开启 session-query 索引；关闭时 `/search` 会给出明确报错。
- Harness 仍处于开发预览阶段；宿主版本不等于 `0.1.0-rc.5` 时，CLI 会显示协议兼容警告。

## 开发与测试

```sh
npm test
npm run check
npm pack
```

测试覆盖参数路由、官方宿主监督、HTTP/WS envelope、流式事件折叠、审批重放去重、问题取消和本地命令路由。

## License

MIT
