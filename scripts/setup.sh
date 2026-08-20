#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GLOBAL=0
SKIP_ORCA=0
SKIP_HARNESS=0

for arg in "$@"; do
  case "$arg" in
    --global) GLOBAL=1 ;;
    --skip-orca) SKIP_ORCA=1 ;;
    --skip-harness) SKIP_HARNESS=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v node >/dev/null || { echo 'Required command not found: node' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Required command not found: npm' >&2; exit 1; }
command -v pnpm >/dev/null || { echo 'Required command not found: pnpm' >&2; exit 1; }

if [ "$SKIP_HARNESS" -eq 0 ]; then
  pnpm --dir "$ROOT/apps/deepseek-harness" install
  pnpm --dir "$ROOT/apps/deepseek-harness" run build
fi

if [ "$SKIP_ORCA" -eq 0 ]; then
  pnpm --dir "$ROOT/apps/orca" install
fi

if [ "$GLOBAL" -eq 1 ]; then
  npm install --global "$ROOT/packages/dsh-terminal-plugin"
  dsh setup "$ROOT/apps/deepseek-harness"
else
  npm install --prefix "$ROOT/packages/dsh-terminal-plugin"
  export DSH_OFFICIAL_BIN="$ROOT/apps/deepseek-harness/apps/cli/lib/bin.js"
  echo "Set DSH_OFFICIAL_BIN for this shell to: $DSH_OFFICIAL_BIN"
  echo "Use: node $ROOT/packages/dsh-terminal-plugin/src/bin.js cli"
fi

echo 'Setup complete.'
