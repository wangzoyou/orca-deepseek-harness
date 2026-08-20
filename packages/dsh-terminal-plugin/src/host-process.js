import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { deferred } from './utils.js'

const PATCH_PATH = fileURLToPath(new URL('../config/cli-surface.patch.yml', import.meta.url))
const READY_PATTERN = /^dsh web:\s+(https?:\/\/[^\s)]+)/

export class HarnessHostProcess {
  constructor({ child, baseUrl, stdoutLines, stderrLines, showLogs, renderer }) {
    this.child = child
    this.baseUrl = new URL(baseUrl)
    this.stdoutLines = stdoutLines
    this.stderrLines = stderrLines
    this.showLogs = showLogs
    this.renderer = renderer
    this.stopped = false
  }

  static async start({ executable, cwd, env = process.env, renderer, showLogs = false, timeoutMs = 120_000 } = {}) {
    const args = [
      ...executable.argsPrefix,
      'web',
      '--patch', PATCH_PATH,
      '--host', '127.0.0.1',
      '--port', '0',
    ]
    renderer?.debug(`启动宿主：${executable.command} ${args.join(' ')}`)
    const child = spawn(executable.command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const ready = deferred()
    const stdoutLines = []
    const stderrLines = []
    let settled = false

    const capture = (target, line) => {
      target.push(line)
      while (target.join('\n').length > 64 * 1024) target.shift()
    }

    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })
    stdout.on('line', line => {
      capture(stdoutLines, line)
      const match = READY_PATTERN.exec(line.trim())
      if (match && !settled) {
        settled = true
        ready.resolve(match[1])
        return
      }
      if (showLogs) renderer?.line(renderer.ansi.gray(`[host] ${line}`))
      else renderer?.debug(`[host] ${line}`)
    })
    stderr.on('line', line => {
      capture(stderrLines, line)
      if (showLogs) renderer?.line(renderer.ansi.gray(`[host:err] ${line}`))
      else renderer?.debug(`[host:err] ${line}`)
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      ready.reject(new Error(`Harness 宿主启动超时。\n${diagnostic(stdoutLines, stderrLines)}`))
      terminateTree(child, true)
    }, timeoutMs)
    timer.unref?.()

    child.once('error', error => {
      if (settled) return
      settled = true
      ready.reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      ready.reject(new Error(
        `Harness 宿主在就绪前退出（code=${String(code)}, signal=${String(signal)}）。\n${diagnostic(stdoutLines, stderrLines)}`,
      ))
    })

    try {
      const baseUrl = await ready.promise
      clearTimeout(timer)
      return new HarnessHostProcess({ child, baseUrl, stdoutLines, stderrLines, showLogs, renderer })
    } catch (error) {
      clearTimeout(timer)
      stdout.close()
      stderr.close()
      throw error
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    terminateTree(this.child, false)
    const exited = new Promise(resolvePromise => this.child.once('exit', resolvePromise))
    let forceTimer
    const forced = new Promise(resolvePromise => {
      forceTimer = setTimeout(() => {
        terminateTree(this.child, true)
        resolvePromise()
      }, 6500)
      forceTimer.unref?.()
    })
    await Promise.race([exited, forced])
    if (forceTimer !== undefined) clearTimeout(forceTimer)
  }

  diagnostics() {
    return diagnostic(this.stdoutLines, this.stderrLines)
  }
}

function diagnostic(stdoutLines, stderrLines) {
  const lines = [...stderrLines.slice(-30), ...stdoutLines.slice(-20)]
  return lines.length === 0 ? '宿主没有输出诊断信息。' : lines.join('\n')
}

function terminateTree(child, force) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    if (force) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.unref()
    } else {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }
    return
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM'
  try {
    // The supervised Harness is its own process group, so a forced shutdown
    // cannot strand worker processes or tool subprocesses behind the CLI.
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}
