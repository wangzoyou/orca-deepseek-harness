import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { SlashMenu } from '../src/slash-menu.js'

// The menu's highlight is inverse video; color must be on for these
// assertions regardless of the ambient shell's NO_COLOR.
delete process.env.NO_COLOR

const ENTRIES = [
  { name: '/approval', description: '本 CLI 如何应答审批询问', takesArg: true },
  { name: '/exit', description: '退出', takesArg: false },
  { name: '/help', description: '显示帮助', takesArg: false },
  { name: '/model', description: '查看或切换模型', takesArg: true },
  { name: '/preset', description: '查看或切换 Agent 预设', takesArg: true },
]

function createMenu() {
  const input = new PassThrough()
  const output = new PassThrough()
  output.isTTY = true
  const rl = { line: '/', cursor: 1, write() {} }
  const menu = new SlashMenu({ input, output, rl, terminal: true })
  menu.setEntriesProvider(async () => ENTRIES)
  return { input, output, rl, menu }
}

/** PassThrough.read() returns one chunk per write; drain the whole buffer. */
function drain(output) {
  let text = ''
  let chunk
  while ((chunk = output.read()) !== null) text += chunk.toString()
  return text
}

test('typing slash opens the menu with every entry', async () => {
  const { output, menu } = createMenu()
  await menu.sync('/', 'composer')
  assert.equal(menu.active, true)
  assert.equal(menu.entries.length, ENTRIES.length)
  assert.match(drain(output), /\/model/)
})

test('live filtering narrows candidates and keeps the highlight valid', async () => {
  const { menu } = createMenu()
  await menu.sync('/', 'composer')
  menu.move(1)
  await menu.sync('/p', 'composer')
  assert.deepEqual(menu.entries.map(entry => entry.name), ['/preset'])
  assert.equal(menu.selected, 0)
})

test('arrow keys move the highlight and are swallowed from readline', async () => {
  const { output, menu } = createMenu()
  await menu.sync('/', 'composer')
  output.read()
  const key = { name: 'down', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, key)
  assert.equal(key.name, 'noop', 'readline must not also see the arrow')
  assert.equal(menu.selected, 1)
  const rendered = drain(output)
  assert.ok(rendered.includes('\x1b[7m'), 'highlighted row uses inverse video')
  const up = { name: 'up', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, up)
  assert.equal(menu.selected, 0)
})

test('Enter on a partial prefix completes the highlighted command with a space', async () => {
  const { rl, menu } = createMenu()
  await menu.sync('/pre', 'composer')
  const key = { name: 'return', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, key)
  assert.equal(key.name, 'noop', 'completing Enter must not submit the line')
  assert.equal(rl.line, '/preset ')
  assert.equal(rl.cursor, '/preset '.length)
  assert.equal(menu.active, false)
})

test('Enter on an exact command name submits instead of completing', async () => {
  const { rl, menu } = createMenu()
  await menu.sync('/exit', 'composer')
  rl.line = '/exit'
  const key = { name: 'return', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, key)
  assert.equal(key.name, 'return', 'exact names fall through to readline submit')
})

test('Esc becomes a backspace so the slash line drops out of the menu', async () => {
  const { menu } = createMenu()
  await menu.sync('/', 'composer')
  const key = { name: 'escape', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, key)
  assert.equal(key.name, 'backspace')
})

test('leaving the slash shape erases the rendered rows', async () => {
  const { output, menu } = createMenu()
  await menu.sync('/', 'composer')
  assert.ok(menu.rows > 0)
  output.read()
  await menu.sync('/model x', 'composer')
  assert.equal(menu.active, false)
  assert.equal(menu.rows, 0)
  assert.ok(drain(output).includes('\x1b[2K'), 'close erases every drawn row')
})

test('LF enter completes the highlighted command just like CR return', async () => {
  const { rl, menu } = createMenu()
  await menu.sync('/pre', 'composer')
  const key = { name: 'enter', ctrl: false, meta: false, shift: false }
  menu.handleKeypress(null, key)
  assert.equal(key.name, 'noop')
  assert.equal(rl.line, '/preset ')
})

test('render and erase use scroll-safe relative cursor moves', async () => {
  const { output, menu } = createMenu()
  await menu.sync('/', 'composer')
  const drawn = drain(output)
  assert.ok(!drawn.includes('\x1b7') && !drawn.includes('\x1b8'), 'no absolute save/restore')
  assert.ok(drawn.includes(`\x1b[${menu.rows}A`), 'returns to the prompt line by relative move')
  menu.close()
  const cleared = drain(output)
  assert.ok(cleared.includes('\x1b[2K') && !cleared.includes('\x1b8'), 'erase is relative too')
})

test('submit-bound Enter erases the menu before readline echoes a newline', async () => {
  const { output, rl, menu } = createMenu()
  await menu.sync('/exit', 'composer')
  rl.line = '/exit'
  drain(output)
  menu.handleKeypress(null, { name: 'return', ctrl: false, meta: false, shift: false })
  assert.equal(menu.active, false)
  assert.ok(drain(output).includes('\x1b[2K'), 'rows erased while still on the prompt line')
})

test('unchanged menu state does not repaint', async () => {
  const { output, menu } = createMenu()
  await menu.sync('/', 'composer')
  drain(output)
  await menu.sync('/', 'composer')
  assert.equal(drain(output), '', 'identical state skips the render')
})

test('menu stays closed outside the composer context', async () => {
  const { menu } = createMenu()
  await menu.sync('/', 'approval')
  assert.equal(menu.active, false)
})

const MANY_ENTRIES = Array.from({ length: 12 }, (_, index) => ({
  name: `/cmd${String(index).padStart(2, '0')}`,
  description: `第 ${index} 条`,
  takesArg: false,
}))

function createLongMenu() {
  const input = new PassThrough()
  const output = new PassThrough()
  output.isTTY = true
  const rl = { line: '/', cursor: 1, write() {} }
  const menu = new SlashMenu({ input, output, rl, terminal: true })
  menu.setEntriesProvider(async () => MANY_ENTRIES)
  return { output, menu }
}

test('highlight moving past the last visible row scrolls the window', async () => {
  const { output, menu } = createLongMenu()
  await menu.sync('/', 'composer')
  for (let index = 0; index < 8; index += 1) menu.move(1)
  assert.equal(menu.selected, 8)
  assert.equal(menu.offset, 1, 'window slides one row to keep the highlight visible')
  const rendered = drain(output)
  assert.match(rendered, /↑ 还有 1 条/, 'top hint shows hidden rows above')
  assert.match(rendered, /\/cmd08/, 'newly visible entry is rendered')
  assert.match(rendered, /↓ 还有 3 条/, 'bottom hint counts the rest')
})

test('wrap-around from the first row jumps to the last page', async () => {
  const { output, menu } = createLongMenu()
  await menu.sync('/', 'composer')
  drain(output)
  menu.move(-1)
  assert.equal(menu.selected, MANY_ENTRIES.length - 1)
  assert.equal(menu.offset, MANY_ENTRIES.length - 8)
  const rendered = drain(output)
  assert.match(rendered, /\/cmd11/, 'last entry is visible after wrapping')
  assert.doesNotMatch(rendered, /\/cmd00 /, 'first page scrolled out')
})

test('filtering back to a short list resets the window', async () => {
  const { menu } = createLongMenu()
  await menu.sync('/', 'composer')
  for (let index = 0; index < 9; index += 1) menu.move(1)
  assert.ok(menu.offset > 0)
  await menu.sync('/cmd01', 'composer')
  assert.equal(menu.offset, 0)
  assert.equal(menu.selected, 0)
})
