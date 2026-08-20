import { Renderer } from './renderer.js'
import { TerminalInput, InputClosed, InputInterrupted } from './input.js'
import { DshRpcClient } from './rpc-client.js'
import { SessionController } from './session-controller.js'
import { CommandRouter } from './commands.js'
import { createCompleter, slashEntries } from './completion.js'
import { HarnessHostProcess } from './host-process.js'
import { ensureOfficialDsh } from './official-dsh.js'
import { cliHelp } from './args.js'
import { TARGET_HARNESS_VERSION } from './utils.js'

export async function runCli(options, io = {}) {
  const output = io.output ?? process.stdout
  const errorOutput = io.errorOutput ?? process.stderr
  const inputStream = io.input ?? process.stdin
  if (options.help) {
    output.write(`${cliHelp()}\n`)
    return 0
  }

  const renderer = new Renderer({
    output,
    errorOutput,
    verbose: options.verbose,
    debug: options.debug,
  })
  let terminalInput
  let host
  let client
  let controller
  let closing = false

  const close = async () => {
    if (closing) return
    closing = true
    terminalInput?.close()
    await controller?.close().catch(() => undefined)
    await client?.close().catch(() => undefined)
    await host?.stop().catch(() => undefined)
    renderer.close()
  }

  const onSigterm = () => {
    void controller?.cancel().catch(() => undefined)
    terminalInput?.close()
  }
  process.on('SIGTERM', onSigterm)

  try {
    let baseUrl = options.connect
    if (!baseUrl) {
      terminalInput = new TerminalInput({ input: inputStream, output })
      renderer.activityStart('正在启动 DeepSeek Harness')
      const executable = await ensureOfficialDsh({ input: terminalInput, renderer })
      const env = {
        ...process.env,
        ...(options.toolsMode ? { DSH_TOOLS_MODE: options.toolsMode } : {}),
      }
      host = await HarnessHostProcess.start({
        executable,
        cwd: options.cwd,
        env,
        renderer,
        showLogs: options.hostLog,
      })
      baseUrl = host.baseUrl
      renderer.activityStop()
    } else {
      renderer.activityStart(`正在连接 ${baseUrl}`)
    }

    client = new DshRpcClient(baseUrl, { debug: options.debug })
    terminalInput ??= new TerminalInput({ input: inputStream, output })
    controller = new SessionController({
      client,
      renderer,
      input: terminalInput,
      approvalPolicy: options.approvalPolicy,
      showHistory: options.showHistory,
    })
    terminalInput.onInterrupt(context => {
      if (context === 'idle') {
        void controller.cancel().catch(error => renderer.error(error.message))
      }
    })
    terminalInput.onExit(() => {
      renderer.notice('正在退出…')
      terminalInput.close()
    })

    await client.connect()
    renderer.activityStop()
    await controller.initialize({
      resume: options.resume,
      cwd: options.cwd,
      agentPreset: options.agentPreset,
      model: options.model,
      reasoning: options.reasoning,
      showHistory: options.showHistory,
    })

    const actualVersion = controller.hostDescription?.version
    if (actualVersion && actualVersion !== TARGET_HARNESS_VERSION) {
      renderer.warning(
        `当前 CLI 按 Harness ${TARGET_HARNESS_VERSION} 协议构建，宿主是 ${actualVersion}；开发预览版可能存在破坏性变更。`,
      )
    }
    if (controller.routable === false) {
      renderer.warning('当前模型路由不可用；用 /model 检查模型，或在官方 Web 设置中配置提供方。')
    }

    const commands = new CommandRouter({ controller, renderer, input: terminalInput })
    terminalInput.setCompleter(createCompleter({ controller }))
    terminalInput.setSlashEntries(() => slashEntries(controller))
    // While a turn is in flight the composer stays live: Ctrl+C on it must
    // cancel the turn (not arm the exit), and the spinner must not paint
    // over the pending prompt.
    terminalInput.busyProvider = () => Boolean(controller.running || controller.activeTurn)
    renderer.quietActivity = () => terminalInput.current?.context === 'composer'
    renderer.composerLine = () => terminalInput.current?.context === 'composer'
    renderer.composerRedraw = () => terminalInput.redrawComposer()
    if (!options.initialPrompt) renderer.notice('输入 / 唤起命令菜单；/help 查看全部命令')
    if (options.initialPrompt) {
      try {
        const result = await commands.handle(options.initialPrompt)
        if (result.exit) return 0
        if (!result.handled) await controller.send(options.initialPrompt)
      } catch (error) {
        if (error instanceof InputClosed) return 0
        if (!(error instanceof InputInterrupted)) renderer.error(formatError(error))
      }
    }

    while (!terminalInput.closed) {
      try {
        const prompt = renderer.ansi.bold(renderer.ansi.blue('› '))
        const continuation = renderer.ansi.dim('· ')
        const text = await terminalInput.multiline(prompt, continuation)
        if (text.trim() === '') continue
        const result = await commands.handle(text)
        if (result.exit) break
        if (!result.handled) {
          // The composer never blocks on a turn: a fresh prompt drives the
          // turn in the background, and the next submission becomes a steer.
          Promise.resolve()
            .then(() => controller.send(text))
            .catch(error => {
              if (!terminalInput.closed) renderer.error(formatError(error))
            })
        }
      } catch (error) {
        if (error instanceof InputInterrupted) {
          renderer.line('')
          if (terminalInput.exitArmed) renderer.notice('再按一次 Ctrl+C 退出')
          continue
        }
        if (error instanceof InputClosed) break
        renderer.error(formatError(error))
      }
    }
    return 0
  } catch (error) {
    renderer.activityStop()
    renderer.error(formatError(error))
    if (host && options.debug) renderer.debug(host.diagnostics())
    return 1
  } finally {
    process.off('SIGTERM', onSigterm)
    await close()
  }
}

function formatError(error) {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' && error.code !== 'internal' ? ` [${error.code}]` : ''
    return `${error.message}${code}`
  }
  return String(error)
}
