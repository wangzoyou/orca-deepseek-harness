import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureOfficialDsh } from '../src/official-dsh.js'

const MISSING = new Error('没有找到官方 DeepSeek Harness CLI')

test('returns the resolved executable without prompting when found', async () => {
  let confirms = 0
  let installs = 0
  const executable = await ensureOfficialDsh({
    resolve: async () => ({ command: 'node', argsPrefix: ['/x/bin.js'], path: '/x/bin.js' }),
    input: { terminal: true, confirm: async () => { confirms += 1; return true } },
    install: async () => { installs += 1 },
  })
  assert.equal(executable.path, '/x/bin.js')
  assert.equal(confirms, 0)
  assert.equal(installs, 0)
})

test('non-interactive input gets the original error instead of a prompt', async () => {
  await assert.rejects(
    () => ensureOfficialDsh({ resolve: async () => { throw MISSING } }),
    error => error === MISSING,
  )
})

test('accepted offer installs, re-resolves, and persists the executable', async () => {
  const calls = []
  let installs = 0
  const persisted = []
  const renderer = {
    warning() {}, success() {},
    activityStart() { calls.push('start') },
    activityStop() { calls.push('stop') },
  }
  const executable = await ensureOfficialDsh({
    resolve: async () => {
      if (installs === 0) throw MISSING
      return { command: 'node', argsPrefix: ['/global/bin.js'], path: '/global/bin.js' }
    },
    input: { terminal: true, confirm: async () => true },
    renderer,
    install: async () => { installs += 1 },
    persist: async value => { persisted.push(value.path) },
  })
  assert.equal(installs, 1)
  assert.equal(executable.path, '/global/bin.js')
  assert.deepEqual(persisted, ['/global/bin.js'])
  assert.deepEqual(calls, ['start', 'stop'])
})

test('declined offer rethrows the original error without installing', async () => {
  let installs = 0
  await assert.rejects(
    () => ensureOfficialDsh({
      resolve: async () => { throw MISSING },
      input: { terminal: true, confirm: async () => false },
      install: async () => { installs += 1 },
    }),
    error => error === MISSING,
  )
  assert.equal(installs, 0)
})
