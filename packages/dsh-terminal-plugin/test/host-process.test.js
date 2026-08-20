import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessHostProcess } from '../src/host-process.js'

test('host supervisor waits for the official readiness line and forwards the CLI patch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-cli-host-'))
  const script = join(directory, 'fake-host.mjs')
  const argsFile = join(directory, 'args.json')
  await writeFile(script, `
    import { writeFileSync } from 'node:fs'
    writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)))
    console.log('dsh web: http://127.0.0.1:43123')
    process.on('SIGTERM', () => process.exit(0))
    setInterval(() => {}, 1000)
  `)
  const renderer = {
    ansi: { gray: value => value },
    debug() {},
    line() {},
  }
  const host = await HarnessHostProcess.start({
    executable: { command: process.execPath, argsPrefix: [script] },
    cwd: directory,
    env: { ...process.env, ARGS_FILE: argsFile },
    renderer,
    timeoutMs: 5000,
  })
  t.after(() => host.stop())
  assert.equal(String(host.baseUrl), 'http://127.0.0.1:43123/')
  const args = JSON.parse(await readFile(argsFile, 'utf8'))
  assert.equal(args[0], 'web')
  assert.ok(args.includes('--patch'))
  assert.deepEqual(args.slice(-4), ['--host', '127.0.0.1', '--port', '0'])
})
