const ESC = '\u001b['

export function createAnsi(output = process.stdout) {
  const enabled = Boolean(output.isTTY) && process.env.NO_COLOR === undefined
  const wrap = (open, close) => text => enabled ? `${ESC}${open}m${text}${ESC}${close}m` : String(text)
  return {
    enabled,
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    italic: wrap('3', '23'),
    underline: wrap('4', '24'),
    inverse: wrap('7', '27'),
    red: wrap('31', '39'),
    green: wrap('32', '39'),
    yellow: wrap('33', '39'),
    blue: wrap('34', '39'),
    magenta: wrap('35', '39'),
    cyan: wrap('36', '39'),
    gray: wrap('90', '39'),
    clearLine: enabled ? `${ESC}2K` : '',
    cursorStart: enabled ? '\r' : '',
    clearScreen: enabled ? `${ESC}2J${ESC}H` : '',
    hideCursor: enabled ? `${ESC}?25l` : '',
    showCursor: enabled ? `${ESC}?25h` : '',
  }
}
