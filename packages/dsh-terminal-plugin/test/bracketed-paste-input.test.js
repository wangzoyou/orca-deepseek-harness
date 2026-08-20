import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { BracketedPasteInput } from '../src/bracketed-paste-input.js'

test('replaces one bracketed paste with an atomic token and restores it exactly', async () => {
  const source = new PassThrough()
  const input = new BracketedPasteInput(source)
  let transformed = ''
  input.on('data', chunk => { transformed += chunk })
  source.pipe(input)

  source.write('before ')
  source.write('\x1b[20')
  source.write('0~alpha\nbeta')
  source.write('\x1b[201')
  source.end('~ after\r')
  await new Promise(resolve => input.once('end', resolve))

  assert.match(transformed, /^before __DSH_BRACKETED_PASTE_1__ after\r$/)
  assert.equal(input.expand(transformed), 'before alpha\nbeta after\r')
})

test('passes incomplete bracket markers through when the input closes', async () => {
  const source = new PassThrough()
  const input = new BracketedPasteInput(source)
  let transformed = ''
  input.on('data', chunk => { transformed += chunk })
  source.pipe(input)
  source.end('x\x1b[200~unfinished')
  await new Promise(resolve => input.once('end', resolve))
  assert.equal(transformed, 'x\x1b[200~unfinished')
})
