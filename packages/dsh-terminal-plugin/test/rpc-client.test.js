import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { DshRpcClient } from '../src/rpc-client.js'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

test('RPC client speaks HTTP-up/WebSocket-down envelopes', async t => {
  const sockets = new Set()
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ path: request.url, body })
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/host.describe') {
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: {
          ok: true,
          value: {
            version: '0.1.0-rc.5',
            cwd: '/workspace',
            attachedSessions: 0,
            canOpenPath: false,
          },
        },
      }))
      return
    }
    if (request.url === '/api/respond') {
      response.end(JSON.stringify({ accepted: true }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })

  server.on('upgrade', (request, socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.on('data', () => socket.end())
    const key = request.headers['sec-websocket-key']
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'))
    const frame = request.url === '/api/events.mux'
      ? { type: 'session/subscribed', sessionId: 's1', lastSeq: -1 }
      : { type: 'host/session-status', sessionId: 's1', running: false }
    socket.write(encodeText(JSON.stringify({
      type: 'server-request',
      rpcId: `${request.url}-rpc`,
      method: frame.type,
      payload: frame,
    })))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const client = new DshRpcClient(`http://127.0.0.1:${address.port}`)
  t.after(async () => {
    await client.close()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })

  const muxEvent = once(client, 'mux')
  await client.connect()
  const [{ frame }] = await muxEvent
  assert.equal(frame.type, 'session/subscribed')
  assert.equal(frame.sessionId, 's1')

  const description = await client.call('host.describe', {})
  assert.equal(description.version, '0.1.0-rc.5')
  assert.equal(requests.at(-1).body.type, 'client-request')
  assert.equal(requests.at(-1).body.method, 'host.describe')

  const receipt = await client.respond('approval-rpc', { outcome: 'rejected' })
  assert.deepEqual(receipt, { accepted: true })
  assert.equal(requests.at(-1).body.type, 'client-response')
})

function encodeText(text) {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  if (payload.length < 65_536) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
    return Buffer.concat([header, payload])
  }
  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 127
  header.writeBigUInt64BE(BigInt(payload.length), 2)
  return Buffer.concat([header, payload])
}
