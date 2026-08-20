# Orca + DeepSeek Harness 一体化仓库

这个仓库把已经验证过的 Orca、官方 DeepSeek Harness，以及 Orca 可识别的 `dsh` 终端插件放在同一个 GitHub 仓库中。别人只需要克隆一次，就能获得完整源码、安装脚本、集成配置和验证命令。

## 包含内容

* `apps/orca/`：Orca 源码，以及 `deepseek-harness` agent 注册、终端状态识别、AI Vault 会话扫描、zstd 多 frame 解压、会话恢复和编排回调。
* `apps/deepseek-harness/`：官方 DeepSeek Harness 源码。
* `packages/dsh-terminal-plugin/`：`dsh` TUI 包装器，支持 Orca 注入多行任务、状态 OSC、`--resume` 和 approval 参数。

## 安装

要求：

* Node.js `22.19+` 或 `24+`
* pnpm
* npm

### Windows PowerShell

```powershell
npm run setup:windows
```

需要全局安装 `dsh` 时：

```powershell
npm run setup:windows -- -Global
```

### macOS / Linux

```sh
sh scripts/setup.sh
```

需要全局安装时：

```sh
sh scripts/setup.sh --global
```

安装脚本会安装依赖、构建 Harness CLI，并让 TUI 指向仓库内的 Harness。

安装完成后可以运行：

```sh
dsh cli
```

在 Orca 中启动开发版：

```sh
pnpm --dir apps/orca dev
```

如果编排 worker 需要通过 Windows named pipe 回调 Orca，请使用：

```sh
dsh cli --approval allow
```

## 验证

根目录快速检查：

```sh
npm test
```

安装 Orca 依赖后，可以运行：

```sh
pnpm run typecheck:orca
pnpm run test:orca-dsh
pnpm run build:orca
```

## DSH 会话

DSH 会话存储在：

```text
~/.dsh/sessions
```

每条事件是一个独立的 zstd frame，因此 Orca 集成解析器会连续解压所有 frame，而不是只解压第一个 frame。

会话恢复命令：

```sh
dsh cli --resume <session-id>
```

## 社区

本项目认可并感谢 **LINUX DO** 社区。

* [LINUX DO](https://linux.do/) — 新的理想型社区

## 开源与第三方声明

上游提交、许可证和集成约定记录在 [`BUNDLE_MANIFEST.json`](BUNDLE_MANIFEST.json)。

第三方声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
