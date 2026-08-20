import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

export const TARGET_HARNESS_VERSION = '0.1.0-rc.5'

/** The installed package version, tolerant of a missing manifest. */
export function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

export function sleep(ms, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(signal.reason ?? new Error('aborted'))
      return
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      cleanup()
      resolvePromise()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      rejectPromise(signal.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

export function shortenPath(path, cwd = process.cwd()) {
  if (typeof path !== 'string' || path.length === 0) return ''
  const home = homedir()
  if (path === home) return '~'
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`
  }
  try {
    const rel = relative(cwd, path)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return `./${rel}`
  } catch {
    // Keep the original path when platform-specific path parsing fails.
  }
  return path
}

export function absolutePath(path, base = process.cwd()) {
  return resolve(base, path)
}

export function truncate(text, max = 160) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function safeJson(value, max = 500) {
  try {
    return truncate(JSON.stringify(value), max)
  } catch {
    return truncate(String(value), max)
  }
}

export function parseJsonObject(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

export function extractTextBlocks(content, { includeReasoning = false } = {}) {
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') chunks.push(block.text)
    else if (includeReasoning && block.type === 'reasoning' && typeof block.text === 'string') chunks.push(block.text)
    else if (block.type === 'tool-result' && Array.isArray(block.content)) {
      const nested = extractTextBlocks(block.content, { includeReasoning })
      if (nested !== '') chunks.push(nested)
    }
  }
  return chunks.join('')
}

export function tokenTotal(usage) {
  if (usage === null || typeof usage !== 'object') return 0
  return ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
    .reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? usage[key] : 0), 0)
}

export function mergeUsage(target, usage) {
  if (usage === null || typeof usage !== 'object') return target
  const next = { ...target }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (Number.isFinite(usage[key])) next[key] = (next[key] ?? 0) + usage[key]
  }
  return next
}

export function formatTokens(count) {
  if (!Number.isFinite(count)) return '0'
  if (count < 1000) return String(Math.round(count))
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}m`
}

export function sessionTitle(summary) {
  const values = summary?.projections?.values
  if (values === null || typeof values !== 'object') return undefined
  for (const [key, value] of Object.entries(values)) {
    if (!key.toLowerCase().includes('title')) continue
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (value && typeof value === 'object' && typeof value.title === 'string' && value.title.trim() !== '') {
      return value.title.trim()
    }
  }
  return undefined
}

export function parseProviderModel(value) {
  const index = value.indexOf('/')
  if (index <= 0 || index === value.length - 1) {
    throw new Error('模型格式应为 provider/model，例如 deepseek/deepseek-chat')
  }
  return { provider: value.slice(0, index), model: value.slice(index + 1) }
}

export function quoteArg(value) {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

export function normalizeBaseUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只支持 http/https Harness 地址，收到 ${url.protocol}`)
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

export function terminalColumns(output = process.stdout) {
  return Math.max(48, Math.min(output.columns || 96, 140))
}

// Good-enough display width for status/header rows without adding a dependency.
export function displayWidth(value) {
  let width = 0
  for (const char of String(value)) {
    const code = char.codePointAt(0)
    if (code === undefined || code === 0) continue
    if (code < 32 || (code >= 0x7f && code < 0xa0)) continue
    width += isFullWidthCodePoint(code) ? 2 : 1
  }
  return width
}

function isFullWidthCodePoint(code) {
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329
    || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)
  )
}

export function fitText(text, width) {
  const value = String(text)
  if (displayWidth(value) <= width) return value
  let result = ''
  for (const char of value) {
    if (displayWidth(`${result}${char}…`) > width) break
    result += char
  }
  return `${result}…`
}

export function splitShellWords(input) {
  const words = []
  let current = ''
  let quote
  let escaped = false
  for (const char of input.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        words.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (escaped) current += '\\'
  if (quote !== undefined) throw new Error('命令中的引号没有闭合')
  if (current !== '') words.push(current)
  return words
}
