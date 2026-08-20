import { zstdDecompressSync } from 'node:zlib'
import { openTranscriptReadStream } from '../native-chat/wsl-transcript-fs-access'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { FileWithMtime, SessionAccumulator } from './session-scanner-types'
import {
  addPreviewContent,
  createAccumulator,
  finalizeSession,
  sessionIdFromFileName,
  updateTimeline
} from './session-scanner-accumulator'
import {
  asRecord,
  extractMessageText,
  extractString,
  parseJsonObject
} from './session-scanner-values'

/** Parse one DeepSeek Harness compressed JSONL transcript. */
export async function parseDeepSeekSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const stream = openTranscriptReadStream(file.path, {}, 'scan')
  const chunks: Buffer[] = []
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk)
    }
  } finally {
    stream.destroy()
  }
  const content = decompressConcatenatedZstdFrames(Buffer.concat(chunks)).toString('utf8')
  return parseDeepSeekSessionContent(file, content, platform)
}

function decompressConcatenatedZstdFrames(input: Buffer): Buffer {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < input.length) {
    // DSH appends each event as a separate zstd frame. Node stops after the
    // first frame, but `info` exposes how many compressed bytes it consumed.
    const result = zstdDecompressSync(input.subarray(offset), { info: true }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    const consumedBytes = result.engine.bytesWritten
    if (!Number.isSafeInteger(consumedBytes) || consumedBytes <= 0 || offset + consumedBytes > input.length) {
      throw new Error('Invalid concatenated zstd frame length')
    }
    chunks.push(result.buffer)
    offset += consumedBytes
  }
  return Buffer.concat(chunks)
}

export function parseDeepSeekSessionContent(
  file: FileWithMtime,
  content: string,
  platform: NodeJS.Platform = process.platform
): AiVaultSession | null {
  const accumulator = createAccumulator({
    agent: 'deepseek-harness',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  for (const line of content.split(/\r?\n/)) {
    consumeDeepSeekSessionLine(accumulator, line)
  }
  return finalizeSession(accumulator, platform)
}

export function consumeDeepSeekSessionLine(accumulator: SessionAccumulator, line: string): void {
  const record = parseJsonObject(line)
  if (!record) {
    return
  }
  updateTimeline(accumulator, record.time)

  if (record.type === 'session') {
    accumulator.sessionId = extractString(record.id) ?? accumulator.sessionId
    accumulator.cwd = extractString(record.cwd) ?? accumulator.cwd
    updateTimeline(accumulator, record.createdAt)
    return
  }

  const data = asRecord(record.data)
  if (!data) {
    return
  }
  if (record.type === 'session/title') {
    accumulator.title = extractString(data.title) ?? accumulator.title
    return
  }
  if (record.type === 'request/header') {
    const config = asRecord(asRecord(data.header)?.config)
    accumulator.model = extractString(config?.model) ?? accumulator.model
    return
  }
  if (record.type !== 'user/message' && record.type !== 'assistant/message') {
    return
  }

  const message = asRecord(data.message) ?? data
  const role = extractString(message.role)
  if (role !== 'user' && role !== 'assistant') {
    return
  }
  accumulator.messageCount++
  if (role === 'user') {
    accumulator.title ??= extractMessageText(message)
  } else {
    accumulator.model =
      extractString(message.model) ??
      extractString(asRecord(message.source)?.model) ??
      accumulator.model
  }
  addPreviewContent(accumulator, role, message.content, record.time)
}
