import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export function configPath(env = process.env) {
  if (env.DSH_CLI_CONFIG_HOME) return join(env.DSH_CLI_CONFIG_HOME, 'config.json')
  const root = process.platform === 'win32'
    ? env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    : env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(root, 'dsh-terminal-plugin', 'config.json')
}

export async function readUserConfig(env = process.env) {
  const path = configPath(env)
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (!value || typeof value !== 'object') return {}
    return {
      ...(typeof value.officialBin === 'string' ? { officialBin: value.officialBin } : {}),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`无法读取 CLI 配置 ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function writeUserConfig(config, env = process.env) {
  const path = configPath(env)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
    await rm(path, { force: true })
    await rename(temporary, path)
  }
  return path
}

export async function clearUserConfig(env = process.env) {
  const path = configPath(env)
  await rm(path, { force: true })
  return path
}
