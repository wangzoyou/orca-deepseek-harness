import { absolutePath } from './utils.js'

const OFFICIAL_SUBCOMMANDS = new Set(['web', 'plugin'])

export function routeArguments(argv) {
  const args = [...argv]
  if (args.length === 0) return { kind: 'cli', options: defaultCliOptions() }

  const first = args[0]
  if (first === 'cli') return { kind: 'cli', options: parseCliOptions(args.slice(1)) }
  if (first === 'setup') return { kind: 'setup', args: args.slice(1) }
  if (first === 'official') return { kind: 'delegate', args: args.slice(1) }
  if (first === 'help' || first === '-h' || first === '--help') return { kind: 'help' }
  if (first === 'version' || first === '-V' || first === '--version') return { kind: 'version' }
  if (OFFICIAL_SUBCOMMANDS.has(first) || first.startsWith('-')) return { kind: 'delegate', args }

  // Codex/Kimi-style convenience: `dsh fix the tests` starts the terminal and
  // submits the positional text as the first prompt.
  return { kind: 'cli', options: { ...defaultCliOptions(), initialPrompt: args.join(' ') } }
}

export function parseCliOptions(argv) {
  const options = defaultCliOptions()
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    const [name, inlineValue] = splitOption(token)
    const value = () => {
      if (inlineValue !== undefined) return inlineValue
      index += 1
      if (index >= argv.length) throw new Error(`${name} 需要一个值`)
      return argv[index]
    }
    switch (name) {
      case '-h':
      case '--help':
        options.help = true
        break
      case '--connect':
      case '--url':
        options.connect = value()
        break
      case '--resume':
        options.resume = value()
        break
      case '--cwd':
        options.cwd = absolutePath(value())
        break
      case '--agent-preset':
        options.agentPreset = value()
        break
      case '--model':
        options.model = value()
        break
      case '--reasoning':
        options.reasoning = value()
        break
      case '--approval': {
        const policy = value()
        if (!['ask', 'allow', 'deny'].includes(policy)) throw new Error('--approval 只能是 ask、allow 或 deny')
        options.approvalPolicy = policy
        break
      }
      case '--no-history':
        options.showHistory = false
        break
      case '--verbose':
        options.verbose = true
        break
      case '--debug':
        options.debug = true
        break
      case '--host-log':
        options.hostLog = true
        break
      case '--tools-mode': {
        const mode = value()
        if (!['native', 'code', 'both'].includes(mode)) throw new Error('--tools-mode 只能是 native、code 或 both')
        options.toolsMode = mode
        break
      }
      default:
        if (token.startsWith('-')) throw new Error(`未知 CLI 参数：${token}`)
        positional.push(token)
    }
  }
  if (positional.length > 0) options.initialPrompt = positional.join(' ')
  return options
}

export function defaultCliOptions() {
  const approvalPolicy = process.env.DSH_CLI_APPROVAL ?? 'ask'
  if (!['ask', 'allow', 'deny'].includes(approvalPolicy)) {
    throw new Error('DSH_CLI_APPROVAL 只能是 ask、allow 或 deny')
  }
  return {
    connect: undefined,
    resume: undefined,
    cwd: process.cwd(),
    agentPreset: undefined,
    model: undefined,
    reasoning: undefined,
    approvalPolicy,
    showHistory: true,
    verbose: false,
    debug: false,
    hostLog: false,
    toolsMode: undefined,
    initialPrompt: undefined,
    help: false,
  }
}

export function wrapperHelp() {
  return `dsh-terminal-plugin

用法:
  dsh                              启动交互式 DeepSeek Harness CLI
  dsh <任务文本>                   启动并立即提交第一条任务
  dsh cli [选项] [任务文本]        显式启动 CLI
  dsh web ...                      转发给官方 dsh web
  dsh --profile <name> ...         转发给官方 profile 启动器
  dsh official <args...>           强制转发任意官方参数
  dsh setup <Harness目录>          固定官方构建产物的位置

CLI 选项:
  --connect <url>                  连接已有 Harness Web 宿主，不新建子进程
  --resume <session-id>            恢复指定会话
  --cwd <path>                     新会话工作目录（默认当前目录）
  --agent-preset <id>              新会话使用的 Agent preset
  --model <provider/model>         启动后切换模型
  --reasoning <level>              与 --model 一起选择推理档位
  --approval ask|allow|deny        审批策略；默认 ask
  --tools-mode native|code|both    设置官方 DSH_TOOLS_MODE
  --no-history                     恢复时不打印历史
  --verbose                        展开工具结果
  --debug                          打印 CLI 协议调试信息
  --host-log                       显示后台 Harness 宿主日志
  -h, --help                       显示本帮助

终端内输入 /help 可查看会话、模型、分叉与审批命令。`
}

export function cliHelp() {
  return wrapperHelp()
}

function splitOption(token) {
  const index = token.indexOf('=')
  if (index <= 0) return [token, undefined]
  return [token.slice(0, index), token.slice(index + 1)]
}
