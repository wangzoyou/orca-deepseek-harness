import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

test('packed command path boots a host, opens a session, and exits cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-cli-e2e-'))
  const fakeHost = join(directory, 'fake-dsh.mjs')
  await writeFile(fakeHost, fakeHostSource())

  const child = spawn(process.execPath, [join(projectRoot, 'src', 'bin.js'), 'cli', '--no-history'], {
    cwd: directory,
    env: {
      ...process.env,
      DSH_OFFICIAL_BIN: fakeHost,
      DSH_CLI_CONFIG_HOME: join(directory, 'config'),
      NO_COLOR: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdin.end('/exit\n')

  const result = await waitForExit(child, 15_000)
  assert.equal(result.code, 0, `stderr:\n${stderr}\nstdout:\n${stdout}`)
  assert.match(stdout, /DeepSeek Harness CLI/)
  assert.match(stdout, /会话 s1/)
  assert.equal(stderr, '')
})

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error(`CLI did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    child.once('error', error => {
      clearTimeout(timer)
      rejectPromise(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal })
    })
  })
}

function fakeHostSource() {
  return `
    import { createServer } from 'node:http'
    import { createHash } from 'node:crypto'

    const sockets = new Set()
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const success = value => ({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value },
      })
      response.setHeader('content-type', 'application/json')
      switch (request.url) {
        case '/api/host.describe':
          response.end(JSON.stringify(success({
            version: '0.1.0-rc.5', cwd: process.cwd(), attachedSessions: 0, canOpenPath: false,
          })))
          break
        case '/api/session.create':
          response.end(JSON.stringify(success({ sessionId: 's1', agentPreset: 'coding' })))
          break
        case '/api/session.history':
          response.end(JSON.stringify(success({ events: [], hasMore: false })))
          break
        case '/api/session.models':
          response.end(JSON.stringify(success({
            current: { provider: 'deepseek', model: 'deepseek-chat' },
            routable: true,
            groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
            failures: [],
          })))
          break
        default:
          response.statusCode = 404
          response.end('{}')
      }
    })

    server.on('upgrade', (request, socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => undefined)
      socket.on('data', () => socket.end())
      const key = request.headers['sec-websocket-key']
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + accept,
        '',
        '',
      ].join('\\r\\n'))
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    console.log('dsh web: http://127.0.0.1:' + address.port)

    const shutdown = () => {
      for (const socket of sockets) socket.destroy()
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 1000).unref()
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  `
}
