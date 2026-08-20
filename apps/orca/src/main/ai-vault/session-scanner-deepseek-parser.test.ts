import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseDeepSeekSessionContent,
  parseDeepSeekSessionFile
} from './session-scanner-deepseek-parser'

const file = {
  path: 'C:/Users/test/.dsh/sessions/session-12345678-1234-4234-8234-123456789012/session.jsonl.zstd',
  mtimeMs: 2,
  modifiedAt: new Date(2).toISOString(),
  sizeBytes: 10
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function deepSeekSessionJsonl(): string {
  return [
    JSON.stringify({
      type: 'session',
      id: 'session-12345678-1234-4234-8234-123456789012',
      createdAt: 1700000000000,
      cwd: 'D:/math/app/test/test'
    }),
    JSON.stringify({ type: 'session/title', time: 1700000001000, data: { title: 'DeepSeek check' } }),
    JSON.stringify({
      type: 'user/message',
      time: 1700000002000,
      data: { role: 'user', content: [{ type: 'text', text: 'Recognize this workspace' }] }
    }),
    JSON.stringify({
      type: 'assistant/message',
      time: 1700000003000,
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Workspace recognized' }],
          source: { kind: 'model', model: 'deepseek-v4' }
        }
      }
    })
  ].join('\n')
}

describe('DeepSeek Harness session parser', () => {
  it('parses compressed-store JSONL event shapes after decompression', () => {
    const session = parseDeepSeekSessionContent(file, deepSeekSessionJsonl())

    expect(session).toMatchObject({
      agent: 'deepseek-harness',
      sessionId: 'session-12345678-1234-4234-8234-123456789012',
      title: 'DeepSeek check',
      cwd: 'D:/math/app/test/test',
      model: 'deepseek-v4',
      messageCount: 2
    })
    expect(session?.resumeCommand).toContain('dsh cli --resume')
    expect(session?.previewMessages.map((message) => message.text)).toEqual([
      'Recognize this workspace',
      'Workspace recognized'
    ])
  })

  it('decompresses and parses a real zstd transcript file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-deepseek-session-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'session.jsonl.zstd')
    const compressed = Buffer.concat(
      deepSeekSessionJsonl()
        .split('\n')
        .map((line) => zstdCompressSync(Buffer.from(`${line}\n`)))
    )
    await writeFile(filePath, compressed)

    const session = await parseDeepSeekSessionFile(
      {
        path: filePath,
        mtimeMs: 2,
        modifiedAt: new Date(2).toISOString(),
        sizeBytes: compressed.byteLength
      },
      'win32'
    )

    expect(session).toMatchObject({
      agent: 'deepseek-harness',
      sessionId: 'session-12345678-1234-4234-8234-123456789012',
      cwd: 'D:/math/app/test/test',
      model: 'deepseek-v4',
      messageCount: 2
    })
  })
})
