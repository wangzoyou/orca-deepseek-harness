import { createAnsi } from './ansi.js'
import { fitText, terminalColumns, truncate } from './utils.js'

/**
 * Interactive slash-command menu, Kimi Code / Claude Code style. While the
 * composer's first word is a bare slash prefix, a live-filtered candidate
 * list renders below the prompt: arrows move the highlight, Enter on a
 * partial prefix completes the highlighted command (Enter on an exact name
 * submits), Esc deletes the '/' and closes the menu, and any close erases
 * the rows it drew.
 *
 * Arrow/Esc keys are swallowed by mutating the shared keypress event object
 * in a prependListener, so readline's own handler (history recall, etc.)
 * sees a no-op key instead. All cursor movement is relative (`\x1b[nA` and
 * friends): absolute save/restore breaks when drawing at the bottom edge,
 * where writing the rows scrolls the screen. Rows are clipped to the
 * terminal width so a wrapped row cannot scroll an extra line and desync
 * the math.
 */

const MENU_PATTERN = /^\/\S*$/
const MAX_ROWS = 8

export class SlashMenu {
  constructor({ input, output, rl, terminal = true, context = 'composer' } = {}) {
    this.input = input
    this.output = output
    this.rl = rl
    this.terminal = terminal
    this.context = context
    this.ansi = createAnsi(output)
    this.entriesProvider = () => []
    this.active = false
    this.entries = []
    this.selected = 0
    this.offset = 0
    this.rows = 0
  }

  /** Provide `() => [{ name, description, takesArg }]`, async allowed. */
  setEntriesProvider(provider) {
    this.entriesProvider = provider
  }

  /**
   * Swallow-and-act for keys the menu owns. Registered as a prependListener,
   * so it runs before readline's handler; mutating the shared key object
   * makes readline treat the key as a no-op.
   */
  handleKeypress(_str, key) {
    if (!this.active) return
    switch (key?.name) {
      case 'up':
        this.move(-1)
        swallow(key)
        break
      case 'down':
        this.move(1)
        swallow(key)
        break
      case 'escape':
        // Deleting the '/' drops the line out of MENU_PATTERN, which closes
        // the menu on the next sync — no dedicated teardown needed here.
        key.name = 'backspace'
        break
      case 'return':
      case 'enter': {
        // Node names CR 'return' and LF 'enter'; real terminals send CR, but
        // LF producers (tmux send-keys, some pty writers) must behave alike.
        const current = this.entries[this.selected]
        if (current && this.rl.line !== current.name) {
          swallow(key)
          this.complete(current)
        } else {
          // The submit echoes a newline and output moves on, so erase while
          // the cursor is still on the prompt line.
          this.close()
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Recompute state from the composer's current line after each keypress.
   * Opens the menu on a slash prefix, live-filters while typing, and closes
   * (erasing rows) once the line leaves the slash-command shape.
   * @param line - the readline buffer after readline processed the key.
   * @param context - the pending question's context; the menu is composer-only.
   */
  async sync(line, context) {
    if (context !== this.context || !MENU_PATTERN.test(line)) {
      if (this.active) this.close()
      return
    }
    let all
    try {
      all = await this.entriesProvider()
    } catch {
      all = []
    }
    const filtered = all.filter(entry => entry.name.startsWith(line))
    if (filtered.length === 0) {
      if (this.active) this.close()
      return
    }
    const previous = this.active ? this.entries[this.selected]?.name : undefined
    this.entries = filtered
    const kept = previous === undefined ? -1 : filtered.findIndex(entry => entry.name === previous)
    this.selected = kept === -1 ? 0 : kept
    if (kept === -1) this.offset = 0
    this.offset = Math.min(this.offset, Math.max(0, filtered.length - MAX_ROWS))
    this.scrollToSelection()
    this.active = true
    this.render()
  }

  move(delta) {
    if (this.entries.length === 0) return
    this.selected = (this.selected + delta + this.entries.length) % this.entries.length
    this.scrollToSelection()
    this.render()
  }

  /** Slide the visible window so the highlighted entry stays on screen. */
  scrollToSelection() {
    if (this.selected < this.offset) this.offset = this.selected
    else if (this.selected >= this.offset + MAX_ROWS) this.offset = this.selected - MAX_ROWS + 1
  }

  /** Fill the highlighted command into the readline buffer and close. */
  complete(entry) {
    const text = entry.takesArg ? `${entry.name} ` : entry.name
    this.rl.line = text
    if (typeof this.rl.cursor === 'number') this.rl.cursor = text.length
    this.close()
    if (this.terminal) {
      // Ctrl+E is a harmless cursor-to-end that makes readline redraw the
      // programmatically replaced buffer.
      this.rl.write(null, { ctrl: true, name: 'e' })
    }
  }

  render() {
    if (!this.terminal) return
    // Keypresses that change nothing visible (e.g. the trailing sync after an
    // arrow move) must not repaint: one render per visible state.
    const signature = `${this.selected}:${this.offset}:${this.entries.map(entry => entry.name).join(',')}`
    if (signature === this.renderedSignature) return
    this.renderedSignature = signature
    this.erase()
    const maxWidth = Math.max(20, terminalColumns(this.output) - 1)
    const visible = this.entries.slice(this.offset, this.offset + MAX_ROWS)
    const rows = []
    if (this.offset > 0) rows.push(this.ansi.dim(fitText(`  ↑ 还有 ${this.offset} 条`, maxWidth)))
    for (let index = 0; index < visible.length; index += 1) {
      const entry = visible[index]
      const name = entry.name.padEnd(16)
      // Width is computed on plain text; styling wraps afterwards, so escape
      // sequences never disturb the no-wrap guarantee.
      const description = entry.description
        ? ` ${truncate(entry.description, Math.min(48, Math.max(0, maxWidth - 19)))}`
        : ''
      const row = fitText(`  ${name}${description}`, maxWidth)
      rows.push(this.offset + index === this.selected ? this.ansi.inverse(row) : row)
    }
    const below = this.entries.length - (this.offset + visible.length)
    if (below > 0) rows.push(this.ansi.dim(fitText(`  ↓ 还有 ${below} 条，继续输入过滤`, maxWidth)))
    this.rows = rows.length
    // '› ' is two cells; \x1b[nG is 1-based. Relative moves stay correct even
    // when writing the rows scrolled the screen at the bottom edge.
    const cursor = typeof this.rl.cursor === 'number' ? this.rl.cursor : 0
    const column = 3 + cursor
    this.output.write(`\n${rows.join('\n')}\x1b[${rows.length}A\x1b[${column}G`)
  }

  erase() {
    if (!this.terminal || this.rows === 0) return
    let clearing = ''
    for (let index = 0; index < this.rows; index += 1) clearing += '\x1b[B\x1b[2K'
    this.output.write(`${clearing}\x1b[${this.rows}A`)
    this.rows = 0
  }

  close() {
    this.active = false
    this.entries = []
    this.selected = 0
    this.offset = 0
    this.renderedSignature = undefined
    this.erase()
  }
}

/** Mutate the shared keypress event so readline's handler ignores the key. */
function swallow(key) {
  key.name = 'noop'
  key.sequence = ''
  key.ctrl = false
  key.meta = false
  key.shift = false
}
