import { createInterface } from 'node:readline/promises'
import { SlashMenu } from './slash-menu.js'
import { BracketedPasteInput } from './bracketed-paste-input.js'

export class InputInterrupted extends Error {
  constructor(context = 'input') {
    super('input interrupted')
    this.name = 'InputInterrupted'
    this.context = context
  }
}

export class InputClosed extends Error {
  constructor() {
    super('input closed')
    this.name = 'InputClosed'
  }
}

export class TerminalInput {
  constructor({ input = process.stdin, output = process.stdout, completer, exitWindowMs = 1500 } = {}) {
    this.input = input
    this.output = output
    this.closed = false
    this.current = undefined
    this.interruptListener = undefined
    this.exitListener = undefined
    this.exitWindowMs = exitWindowMs
    this.exitArmed = false
    this.exitTimer = undefined
    this.completer = completer
    this.terminal = Boolean(input.isTTY && output.isTTY)
    this.readlineInput = new BracketedPasteInput(input)
    input.pipe(this.readlineInput)
    this.rl = createInterface({
      input: this.readlineInput,
      output,
      terminal: this.terminal,
      historySize: 500,
      removeHistoryDuplicates: true,
      // Node 26 awaits the completer's returned [matches, completeOn]; the old
      // (line, callback) form is gone. A second consecutive TAB is what shows
      // the candidate list, which the slash popup below synthesizes.
      completer: async line => {
        if (!this.completer) return [[], line]
        try {
          return await this.completer(line)
        } catch {
          return [[], line]
        }
      },
    })
    this.rl.on('SIGINT', () => {
      const current = this.current
      let context = current?.context ?? 'idle'
      // With the composer kept live during a turn, a composer Ctrl+C while
      // busy means cancel-the-turn, not arm-the-exit.
      if (context === 'composer' && this.busyProvider?.()) context = 'busy'
      // Erase the menu before the abort moves output past the prompt line.
      this.menu.close()
      // Double Ctrl+C at the composer exits the CLI: the first press arms the
      // exit (and interrupts the line as usual), the second within the window
      // requests it. Approvals, questions, and running turns keep their
      // cancel semantics and never arm the exit.
      if (context === 'composer' && this.exitArmed) {
        this.disarmExit()
        this.exitListener?.()
        return
      }
      if (context === 'composer') this.armExit()
      current?.abort.abort(new InputInterrupted(context))
      this.interruptListener?.(context === 'busy' ? 'idle' : context)
    })
    this.rl.on('close', () => {
      this.closed = true
      this.current?.abort.abort(new InputClosed())
    })
    // Interactive slash menu: a prependListener swallows the keys it owns
    // (arrows, Esc, completing Enter) by mutating the shared key event, while
    // a trailing listener resyncs the menu from the line readline produced.
    this.menu = new SlashMenu({ input, output, rl: this.rl, terminal: this.terminal })
    this.readlineInput.prependListener('keypress', (str, key) => {
      this.menu.handleKeypress(str, key)
    })
    this.readlineInput.on('keypress', (_str, key) => {
      // Any real typing disarms the double-Ctrl+C exit; the arming Ctrl+C
      // itself arrives as a ctrl+c keypress and must not disarm.
      if (this.exitArmed && !(key?.ctrl && key?.name === 'c')) this.disarmExit()
      if (!this.terminal) return
      setImmediate(() => {
        if (this.closed) return
        void this.menu.sync(this.rl.line, this.current?.context)
      })
    })
    // Keep the source-level hook for embedders/tests that synthesize keypress
    // events before the decoder stream; real terminal keypresses arrive on
    // `readlineInput` above.
    this.input.on('keypress', (_str, key) => {
      if (this.exitArmed && !(key?.ctrl && key?.name === 'c')) this.disarmExit()
    })
  }

  /** Late-bound completer `(line) => [matches, completeOn]` (async allowed). */
  setCompleter(completer) {
    this.completer = completer
  }

  /** Provide the slash menu's entries: `() => [{ name, description, takesArg }]`. */
  setSlashEntries(provider) {
    this.menu.setEntriesProvider(provider)
  }

  onInterrupt(listener) {
    this.interruptListener = listener
  }

  /** Called when the user confirms exit with a second composer Ctrl+C. */
  onExit(listener) {
    this.exitListener = listener
  }

  armExit() {
    this.exitArmed = true
    if (this.exitTimer !== undefined) clearTimeout(this.exitTimer)
    this.exitTimer = setTimeout(() => this.disarmExit(), this.exitWindowMs)
    this.exitTimer.unref?.()
  }

  disarmExit() {
    this.exitArmed = false
    if (this.exitTimer !== undefined) clearTimeout(this.exitTimer)
    this.exitTimer = undefined
  }

  async question(prompt, { context = 'input', trim = false } = {}) {
    if (this.closed) throw new InputClosed()
    if (context === 'composer') this.composerPrompt = prompt
    const abort = new AbortController()
    this.current = { abort, context }
    try {
      const value = this.readlineInput.expand(await this.rl.question(prompt, { signal: abort.signal }))
      return trim ? value.trim() : value
    } catch (error) {
      if (error instanceof InputInterrupted || error instanceof InputClosed) throw error
      if (error?.name === 'AbortError') {
        const reason = abort.signal.reason
        if (reason instanceof InputClosed) throw reason
        if (reason instanceof InputInterrupted) throw reason
        throw new InputInterrupted(context)
      }
      throw error
    } finally {
      if (this.current?.abort === abort) this.current = undefined
    }
  }

  async multiline(prompt = '› ', continuation = '· ') {
    const lines = []
    while (true) {
      const line = await this.question(lines.length === 0 ? prompt : continuation, { context: 'composer' })
      if (hasContinuation(line)) {
        lines.push(line.slice(0, -1))
        continue
      }
      lines.push(line)
      return lines.join('\n')
    }
  }

  async confirm(prompt, { defaultValue = false, context = 'confirm' } = {}) {
    const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] '
    const answer = (await this.question(`${prompt}${suffix}`, { context, trim: true })).toLowerCase()
    if (answer === '') return defaultValue
    return answer === 'y' || answer === 'yes' || answer === '是'
  }

  async choose(prompt, count, { allowZero = false, context = 'choice' } = {}) {
    while (true) {
      const answer = await this.question(prompt, { context, trim: true })
      if (allowZero && (answer === '' || answer === '0')) return undefined
      const index = Number(answer)
      if (Number.isInteger(index) && index >= 1 && index <= count) return index - 1
      this.output.write(`请输入 1-${count}${allowZero ? '，或 0 取消' : ''}。\n`)
    }
  }

  /**
   * Reprint the pending composer after renderer output scrolled past it, so
   * streamed text never strands the user's half-typed line.
   */
  redrawComposer() {
    if (!this.terminal || this.closed || this.current?.context !== 'composer') return
    this.output.write(`${this.composerPrompt ?? '› '}${this.rl.line ?? ''}`)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.disarmExit()
    this.menu.close()
    this.current?.abort.abort(new InputClosed())
    this.rl.close()
    this.input.unpipe(this.readlineInput)
    this.readlineInput.destroy()
  }
}

function hasContinuation(line) {
  let slashes = 0
  for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}
