import { stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { clearUserConfig, configPath, readUserConfig, writeUserConfig } from './config.js'

export async function runSetup(args, { output = process.stdout, env = process.env } = {}) {
  if (args.includes('--clear')) {
    const path = await clearUserConfig(env)
    output.write(`已清除 dsh CLI 配置：${path}\n`)
    return 0
  }

  if (args.length === 0) {
    const config = await readUserConfig(env)
    output.write(`配置文件：${configPath(env)}\n`)
    output.write(`官方 dsh：${config.officialBin ?? '未固定；启动时自动发现'}\n`)
    output.write('用法：dsh setup <deepseek-harness 根目录或 apps/cli/lib/bin.js>\n')
    return 0
  }

  const requested = resolve(args.join(' '))
  const info = await stat(requested).catch(() => undefined)
  let officialBin
  if (info?.isFile()) officialBin = requested
  else if (info?.isDirectory()) officialBin = join(requested, 'apps', 'cli', 'lib', 'bin.js')
  else throw new Error(`路径不存在：${requested}`)

  const binInfo = await stat(officialBin).catch(() => undefined)
  if (!binInfo?.isFile()) {
    throw new Error(`找不到构建后的官方 CLI：${officialBin}\n请先在 DeepSeek Harness 根目录运行 pnpm run build。`)
  }
  const path = await writeUserConfig({ officialBin }, env)
  output.write(`已保存官方 dsh：${officialBin}\n`)
  output.write(`配置文件：${path}\n`)
  return 0
}
