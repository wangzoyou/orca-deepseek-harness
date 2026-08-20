# 接入现有 DeepSeek Harness fork

## 推荐：保持独立包

最省维护的方式是让本包作为 Harness fork 的同级目录或独立仓库存在：

```text
workspace/
  deepseek-harness/
  dsh-terminal-plugin/
```

构建 Harness：

```sh
cd deepseek-harness
pnpm install
pnpm run build
```

安装本包并固定构建产物：

```sh
cd ../dsh-terminal-plugin
npm install -g .
dsh setup ../deepseek-harness
```

`DSH_OFFICIAL_BIN=../deepseek-harness/apps/cli/lib/bin.js` 仍可作为不写用户配置的临时覆盖。

这条路线不改官方 `apps/cli`，同步 upstream 时冲突最少。

## 放进 monorepo

也可以把目录放到 Harness 仓库，例如：

```text
packages/ui/terminal-frontdoor/
```

需要做三件事：

1. 把 `package.json` 加入 pnpm workspace。
2. 将 `@deepseek-ai/dsh` 从 `optionalDependencies` 改成 `workspace:^`。
3. 保留本包自己的 `bin.dsh` 只用于独立发布；monorepo 开发时通过脚本调用 `src/bin.js`，避免与官方 app 的 bin 链接互相覆盖。

示例根脚本：

```json
{
  "scripts": {
    "terminal": "node packages/ui/terminal-frontdoor/src/bin.js cli"
  }
}
```

然后：

```sh
pnpm terminal
```

## 让官方裸 `dsh` 直接进入终端

不建议立刻改官方 `apps/cli/src/args.ts`，因为这会改变现有 launcher 的“必须给 `--profile`”语义，也会把终端产品生命周期重新塞回官方 app。

确实要合并时，可采用较小的 dispatcher 改动：

- 无参数：动态 import terminal runner。
- `cli` 子命令：动态 import terminal runner。
- `web`、`plugin`、`--profile`：保留原分支。
- terminal runner 仍启动 Web profile + patch，不在 `apps/cli` 内复制运行时。

本包的 `routeArguments()` 和 `runCli()` 已经把这层分开，可以直接复用。

## 桌面端共存

桌面端与终端端都应当连接同一个 Host API，而不是互相 import UI 组件。可共享的代码只有：

- RPC envelope 类型与传输适配。
- session event fold。
- model/session directory 的纯数据转换。

终端渲染和桌面渲染应保持独立。这样桌面端换框架、终端端换 readline/TUI 库，都不会动 Harness 运行时。

## 发布前检查

```sh
npm test
npm run check
npm pack --dry-run
```

随后用三套 shell 做 smoke test：

```sh
# Bash / Zsh
dsh --version
dsh

# PowerShell
dsh.cmd --version
dsh.cmd
```

最后至少验证一次：模型流式输出、bash/pwsh 工具审批、`Ctrl+C` 取消、`/resume`、`/model`、宿主退出后端口释放。
