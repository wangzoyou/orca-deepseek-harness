import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { deferred, normalizeBaseUrl, sleep } from './utils.js'

export class DshRpcError extends Error {
  constructor(error, method) {
    super(error?.message ?? `RPC ${method} failed`)
    this.name = 'DshRpcError'
    this.code = error?.code ?? 'internal'
    this.details = error?.details ?? {}
    this.method = method
  }
}

export class DshRpcClient extends EventEmitter {
  constructor(baseUrl, { timeoutMs = 30_000, debug = false } = {}) {
    super()
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.timeoutMs = timeoutMs
    this.debug = debug
    this.closed = false
    this.mux = new Downlink(new URL('/api/events.mux', this.baseUrl), 'mux', envelope => this.handleEnvelope('mux', envelope), event => this.emit('transport', event))
    this.host = new Downlink(new URL('/api/events.host', this.baseUrl), 'host', envelope => this.handleEnvelope('host', envelope), event => this.emit('transport', event))
  }

  async connect({ timeoutMs = 30_000 } = {}) {
    if (typeof WebSocket !== 'function') throw new Error('当前 Node.js 没有全局 WebSocket；请使用 Node 22.19+ 或 Node 24+')
    const start = Promise.all([this.mux.start(), this.host.start()])
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`连接 Harness 事件流超时：${this.baseUrl}`)), timeoutMs)
      timer.unref?.()
    })
    try {
      await Promise.race([start, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async call(method, payload, { signal, timeoutMs = this.timeoutMs } = {}) {
    const rpcId = randomUUID()
    const request = { type: 'client-request', rpcId, method, payload }
    const response = await this.post(`/api/${method}`, request, { signal, timeoutMs })
    if (response?.type !== 'server-response') throw new Error(`RPC ${method} 返回了错误的 envelope type`)
    if (response.rpcId !== rpcId) throw new Error(`RPC ${method} 的 rpcId 不匹配`)
    if (!response.result?.ok) throw new DshRpcError(response.result?.error, method)
    return response.result.value
  }

  async respond(rpcId, value, { signal } = {}) {
    const message = {
      type: 'client-response',
      rpcId,
      result: { ok: true, value },
    }
    return this.post('/api/respond', message, { signal, timeoutMs: this.timeoutMs })
  }

  async respondError(rpcId, error, { signal } = {}) {
    const message = {
      type: 'client-response',
      rpcId,
      result: {
        ok: false,
        error: {
          code: error?.code ?? 'cancelled',
          message: error?.message ?? 'cancelled',
          details: error?.details ?? {},
        },
      },
    }
    return this.post('/api/respond', message, { signal, timeoutMs: this.timeoutMs })
  }

  /** Download a session log ZIP (host-only GET channel), returning its bytes. */
  async downloadSessionZip(sessionId, { signal } = {}) {
    const url = new URL('/api/session.export', this.baseUrl)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('includeDescendants', 'true')
    let response
    try {
      response = await fetch(url, { signal: signal ?? AbortSignal.timeout(this.timeoutMs) })
    } catch (error) {
      throw new Error(`连接 Harness 失败（session.export）：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`导出会话失败：HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  async post(path, body, { signal, timeoutMs } = {}) {
    const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
    const requestSignal = signal && timeoutSignal ? AbortSignal.any([signal, timeoutSignal]) : signal ?? timeoutSignal
    let response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: requestSignal,
      })
    } catch (error) {
      throw new Error(`连接 Harness 失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`Harness ${path} 返回 HTTP ${response.status}${text ? `：${text}` : ''}`)
    try {
      return text === '' ? {} : JSON.parse(text)
    } catch {
      throw new Error(`Harness ${path} 返回了非 JSON 内容：${text.slice(0, 300)}`)
    }
  }

  handleEnvelope(kind, envelope) {
    if (!envelope || envelope.type !== 'server-request' || typeof envelope.rpcId !== 'string') {
      this.emit('stream-error', new Error(`${kind} 收到无效 server-request envelope`))
      return
    }
    const frame = envelope.payload
    if (!frame || typeof frame.type !== 'string') {
      this.emit('stream-error', new Error(`${kind} 收到无效 frame`))
      return
    }
    if (frame.type === 'stream/error') {
      this.emit('stream-error', new DshRpcError(frame.error, `${kind}-stream`))
      return
    }
    this.emit(kind, { rpcId: envelope.rpcId, frame })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    await Promise.all([this.mux.close(), this.host.close()])
    this.removeAllListeners()
  }
}

class Downlink {
  constructor(url, kind, onEnvelope, onTransport) {
    this.url = new URL(url)
    this.kind = kind
    this.onEnvelope = onEnvelope
    this.onTransport = onTransport
    this.abort = new AbortController()
    this.socket = undefined
    this.loopPromise = undefined
    this.firstOpen = deferred()
    this.openCount = 0
    this.closed = false
  }

  start() {
    if (this.loopPromise === undefined) this.loopPromise = this.loop()
    return this.firstOpen.promise
  }

  async loop() {
    let delay = 200
    while (!this.closed && !this.abort.signal.aborted) {
      try {
        await this.openOnce()
        delay = 200
      } catch (error) {
        if (!this.closed) this.onTransport({ kind: this.kind, state: 'error', error })
      }
      if (this.closed || this.abort.signal.aborted) break
      this.onTransport({ kind: this.kind, state: 'reconnecting', delay })
      try { await sleep(delay, this.abort.signal) } catch { break }
      delay = Math.min(delay * 2, 3000)
    }
  }

  openOnce() {
    return new Promise((resolvePromise, rejectPromise) => {
      const url = new URL(this.url)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      this.socket = socket
      let opened = false
      let settled = false
      let messageChain = Promise.resolve()

      const finish = (kind, error) => {
        if (settled) return
        settled = true
        if (this.socket === socket) this.socket = undefined
        if (kind === 'error' && !opened) rejectPromise(error ?? new Error(`${this.kind} WebSocket failed`))
        else resolvePromise()
      }
      socket.addEventListener('open', () => {
        opened = true
        this.openCount += 1
        if (this.openCount === 1) this.firstOpen.resolve()
        this.onTransport({ kind: this.kind, state: this.openCount === 1 ? 'open' : 'reconnected', count: this.openCount })
      }, { once: true })
      socket.addEventListener('message', event => {
        messageChain = messageChain.then(async () => {
          try {
            const text = typeof event.data === 'string'
              ? event.data
              : event.data && typeof event.data.text === 'function'
                ? await event.data.text()
                : new TextDecoder().decode(event.data)
            this.onEnvelope(JSON.parse(text))
          } catch (error) {
            this.onTransport({ kind: this.kind, state: 'malformed', error })
          }
        })
      })
      socket.addEventListener('error', () => {
        if (!opened) finish('error', new Error(`${this.kind} WebSocket 连接失败：${url}`))
      }, { once: true })
      socket.addEventListener('close', event => {
        void messageChain.finally(() => finish('close'))
        if (opened && !this.closed) {
          this.onTransport({ kind: this.kind, state: 'closed', code: event.code, reason: event.reason })
        }
      }, { once: true })
      if (this.abort.signal.aborted) socket.close()
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    const socket = this.socket
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) socket.close()
    await this.loopPromise?.catch(() => undefined)
  }
}
