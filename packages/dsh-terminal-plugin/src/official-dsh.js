import { spawn, execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile } from 'node:fs/promises'
import { dirname, extname, join, parse, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readUserConfig, writeUserConfig } from './config.js'

const execFileAsync = promisify(execFile)

export async function resolveOfficialDsh() {
  const override = process.env.DSH_OFFICIAL_BIN
  if (override) return requireExecutable(resolve(override), 'DSH_OFFICIAL_BIN')

  const configured = await readUserConfig()
  if (configured.officialBin && await exists(configured.officialBin)) {
    return executableFor(configured.officialBin)
  }

  const rootOverride = process.env.DSH_HARNESS_ROOT
  if (rootOverride) {
    return requireExecutable(join(resolve(rootOverride), 'apps', 'cli', 'lib', 'bin.js'), 'DSH_HARNESS_ROOT')
  }

  const require = createRequire(import.meta.url)
  try {
    const packagePath = require.resolve('@deepseek-ai/dsh/package.json')
    return loadPackageExecutable(packagePath)
  } catch {
    // The official package is not necessarily published for every preview;
    // continue with checkout/global discovery.
  }

  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))]
  for (const start of starts) {
    const checkout = await findCheckoutExecutable(start)
    if (checkout) return checkout
  }

  for (const root of globalModuleRoots()) {
    const packagePath = join(root, '@deepseek-ai', 'dsh', 'package.json')
    if (await exists(packagePath)) return loadPackageExecutable(packagePath)
  }

  throw new Error(
    '没有找到官方 DeepSeek Harness CLI。请先构建 Harness，然后运行 '
    + '`dsh setup /path/to/deepseek-harness`，或设置 DSH_OFFICIAL_BIN 指向 apps/cli/lib/bin.js。',
  )
}

/**
 * Resolve the official CLI, and when nothing is found offer the brainless
 * path on interactive terminals: install `@deepseek-ai/dsh` globally and pin
 * the result, so the next run needs no setup at all.
 * `install`/`persist` are injectable for tests.
 */
export async function ensureOfficialDsh({
  input,
  renderer,
  install = defaultInstall,
  persist = async executable => writeUserConfig({ officialBin: executable.path }),
  resolve: resolveFn = resolveOfficialDsh,
} = {}) {
  try {
    return await resolveFn()
  } catch (error) {
    if (input?.terminal !== true || typeof input?.confirm !== 'function') throw error
    renderer?.warning(error.message)
    const accepted = await input.confirm('现在运行 npm install -g @deepseek-ai/dsh 安装官方 CLI 吗？', {
      defaultValue: true,
      context: 'install-official',
    })
    if (!accepted) throw error
    renderer?.activityStart('正在安装 @deepseek-ai/dsh …')
    try {
      await install()
    } finally {
      renderer?.activityStop()
    }
    const executable = await resolveFn()
    try {
      await persist(executable)
      renderer?.success(`已安装并固定官方 CLI：${executable.path}`)
    } catch {
      renderer?.success('已安装官方 CLI')
    }
    return executable
  }
}

async function defaultInstall() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await execFileAsync(command, ['install', '-g', '@deepseek-ai/dsh'], { timeout: 180_000 })
}

async function loadPackageExecutable(packagePath) {
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (typeof bin !== 'string' || bin === '') throw new Error(`${packagePath} 没有 dsh bin`)
  return {
    ...executableFor(resolve(dirname(packagePath), bin)),
    ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
  }
}

async function findCheckoutExecutable(start) {
  let current = resolve(start)
  while (true) {
    const packagePath = join(current, 'apps', 'cli', 'package.json')
    const binPath = join(current, 'apps', 'cli', 'lib', 'bin.js')
    if (await exists(packagePath) && await exists(binPath)) {
      try {
        const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
        if (manifest.name === '@deepseek-ai/dsh') {
          return {
            ...executableFor(binPath),
            ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
          }
        }
      } catch {
        // Keep walking; a malformed unrelated apps/cli/package.json is not a match.
      }
    }
    const parent = dirname(current)
    if (parent === current || current === parse(current).root) return undefined
    current = parent
  }
}

function globalModuleRoots() {
  const roots = new Set()
  for (const command of [
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ]) {
    try {
      const value = execFileSync(command, ['root', '-g'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).trim()
      if (value) roots.add(value)
    } catch {
      // Package manager absent or global root unavailable.
    }
  }
  return [...roots]
}

async function requireExecutable(path, source) {
  if (!await exists(path)) throw new Error(`${source} 指向的文件不存在：${path}`)
  return executableFor(path)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function executableFor(path) {
  const extension = extname(path).toLowerCase()
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs' || extension === '.ts') {
    return { command: process.execPath, argsPrefix: [path], path }
  }
  return { command: path, argsPrefix: [], path }
}

export async function delegateOfficial(args, { cwd = process.cwd(), env = process.env } = {}) {
  const executable = await resolveOfficialDsh()
  const child = spawn(executable.command, [...executable.argsPrefix, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  const forwardSignal = signal => {
    try { child.kill(signal) } catch { /* child already gone */ }
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise)
      child.once('exit', (code, signal) => {
        if (typeof code === 'number') resolvePromise(code)
        else resolvePromise(signal === 'SIGINT' ? 130 : 1)
      })
    })
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}
