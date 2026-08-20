import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const files = (await readdir(new URL('../src/', import.meta.url)))
  .filter(file => file.endsWith('.js'))
  .sort()

for (const file of files) {
  const path = fileURLToPath(new URL(`../src/${file}`, import.meta.url))
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
