import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanAiVaultSessions } from './session-scanner'
import {
  isolatedScanRoots,
  writeDeepSeekScannerFixture
} from './session-scanner-test-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('DeepSeek Harness session discovery', () => {
  it('discovers a compressed transcript through the unified AI Vault scanner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-deepseek-'))
    temporaryDirectories.push(root)
    const roots = isolatedScanRoots(root)
    const sessionId = await writeDeepSeekScannerFixture(roots.deepseekSessionsDir)

    const result = await scanAiVaultSessions({ ...roots, platform: 'win32', unlimited: true })

    expect(result.issues).toEqual([])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      agent: 'deepseek-harness',
      sessionId,
      title: 'DeepSeek title',
      cwd: '/tmp/deepseek',
      model: 'deepseek-v4',
      messageCount: 1
    })
    expect(result.sessions[0]?.resumeCommand).toContain('dsh cli --resume')
    expect(result.sessions[0]?.resumeCommand).toContain(sessionId)
  })
})
