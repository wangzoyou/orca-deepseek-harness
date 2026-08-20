import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export class BracketedPasteInput extends Transform {
  constructor(source) {
    super()
    this.source = source
    this.isTTY = Boolean(source.isTTY)
    this.decoder = new StringDecoder('utf8')
    this.pending = ''
    this.paste = null
    this.pastes = new Map()
    this.nextPasteId = 1
  }

  setRawMode(enabled) {
    return this.source.setRawMode?.(enabled)
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.process(this.decoder.write(chunk))
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush(callback) {
    try {
      this.process(this.decoder.end(), true)
      if (this.paste !== null) this.push(`${PASTE_START}${this.paste}${this.pending}`)
      else if (this.pending) this.push(this.pending)
      this.pending = ''
      this.paste = null
      callback()
    } catch (error) {
      callback(error)
    }
  }

  process(text, flush = false) {
    this.pending += text
    while (this.pending) {
      if (this.paste === null) {
        const start = this.pending.indexOf(PASTE_START)
        if (start >= 0) {
          if (start > 0) this.push(this.pending.slice(0, start))
          this.pending = this.pending.slice(start + PASTE_START.length)
          this.paste = ''
          continue
        }
        const keep = flush ? 0 : partialSuffixLength(this.pending, PASTE_START)
        const ready = this.pending.slice(0, this.pending.length - keep)
        if (ready) this.push(ready)
        this.pending = this.pending.slice(this.pending.length - keep)
        return
      }

      const end = this.pending.indexOf(PASTE_END)
      if (end >= 0) {
        this.paste += this.pending.slice(0, end)
        this.pending = this.pending.slice(end + PASTE_END.length)
        const token = `__DSH_BRACKETED_PASTE_${this.nextPasteId++}__`
        this.pastes.set(token, this.paste)
        this.paste = null
        this.push(token)
        continue
      }
      const keep = flush ? 0 : partialSuffixLength(this.pending, PASTE_END)
      this.paste += this.pending.slice(0, this.pending.length - keep)
      this.pending = this.pending.slice(this.pending.length - keep)
      return
    }
  }

  expand(value) {
    let expanded = String(value)
    for (const [token, paste] of this.pastes) {
      if (!expanded.includes(token)) continue
      expanded = expanded.split(token).join(paste)
      this.pastes.delete(token)
    }
    return expanded
  }
}

function partialSuffixLength(value, marker) {
  for (let length = Math.min(value.length, marker.length - 1); length > 0; length -= 1) {
    if (value.endsWith(marker.slice(0, length))) return length
  }
  return 0
}
