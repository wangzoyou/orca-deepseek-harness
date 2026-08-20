import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { runSetup } from '../src/setup.js'
import { configPath } from '../src/config.js'
import { resolveOfficialDsh } from '../src/official-dsh.js'

class Capture extends Writable {
  constructor() {
    super()
    this.text = ''
  }
  _write(chunk, _encoding, callback) {
    this.text += chunk.toString()
    callback()
  }
}

test('setup stores a built Harness CLI and resolver reads it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness-root-'))
  const configHome = await mkdtemp(join(tmpdir(), 'dsh-cli-config-'))
  const cliDir = join(root, 'apps', 'cli', 'lib')
  await mkdir(cliDir, { recursive: true })
  const bin = join(cliDir, 'bin.js')
  await writeFile(bin, '#!/usr/bin/env node\n')
  const env = { ...process.env, DSH_CLI_CONFIG_HOME: configHome }
  const output = new Capture()
  await runSetup([root], { output, env })
  const saved = JSON.parse(await readFile(configPath(env), 'utf8'))
  assert.equal(saved.officialBin, bin)
  assert.match(output.text, /已保存官方 dsh/)

  const previousConfigHome = process.env.DSH_CLI_CONFIG_HOME
  const previousBin = process.env.DSH_OFFICIAL_BIN
  const previousRoot = process.env.DSH_HARNESS_ROOT
  process.env.DSH_CLI_CONFIG_HOME = configHome
  delete process.env.DSH_OFFICIAL_BIN
  delete process.env.DSH_HARNESS_ROOT
  try {
    const executable = await resolveOfficialDsh()
    assert.equal(executable.path, bin)
    assert.equal(executable.command, process.execPath)
  } finally {
    if (previousConfigHome === undefined) delete process.env.DSH_CLI_CONFIG_HOME
    else process.env.DSH_CLI_CONFIG_HOME = previousConfigHome
    if (previousBin === undefined) delete process.env.DSH_OFFICIAL_BIN
    else process.env.DSH_OFFICIAL_BIN = previousBin
    if (previousRoot === undefined) delete process.env.DSH_HARNESS_ROOT
    else process.env.DSH_HARNESS_ROOT = previousRoot
  }
})

test('DSH_HARNESS_ROOT discovers apps/cli/lib/bin.js', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness-env-'))
  const configHome = await mkdtemp(join(tmpdir(), 'dsh-cli-empty-'))
  const cliDir = join(root, 'apps', 'cli', 'lib')
  await mkdir(cliDir, { recursive: true })
  const bin = join(cliDir, 'bin.js')
  await writeFile(bin, '#!/usr/bin/env node\n')
  const oldRoot = process.env.DSH_HARNESS_ROOT
  const oldConfig = process.env.DSH_CLI_CONFIG_HOME
  const oldBin = process.env.DSH_OFFICIAL_BIN
  process.env.DSH_HARNESS_ROOT = root
  process.env.DSH_CLI_CONFIG_HOME = configHome
  delete process.env.DSH_OFFICIAL_BIN
  try {
    const executable = await resolveOfficialDsh()
    assert.equal(executable.path, bin)
  } finally {
    if (oldRoot === undefined) delete process.env.DSH_HARNESS_ROOT
    else process.env.DSH_HARNESS_ROOT = oldRoot
    if (oldConfig === undefined) delete process.env.DSH_CLI_CONFIG_HOME
    else process.env.DSH_CLI_CONFIG_HOME = oldConfig
    if (oldBin === undefined) delete process.env.DSH_OFFICIAL_BIN
    else process.env.DSH_OFFICIAL_BIN = oldBin
  }
})
