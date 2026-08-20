param(
  [switch]$Global,
  [switch]$SkipOrcaInstall,
  [switch]$SkipHarnessInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Assert-Command node
Assert-Command npm
Assert-Command pnpm

node --version
pnpm --version
npm --version

if (-not $SkipHarnessInstall) {
  pnpm --dir (Join-Path $root 'apps/deepseek-harness') install
  pnpm --dir (Join-Path $root 'apps/deepseek-harness') run build
}

if (-not $SkipOrcaInstall) {
  pnpm --dir (Join-Path $root 'apps/orca') install
}

$plugin = Join-Path $root 'packages/dsh-terminal-plugin'
if ($Global) {
  npm install --global $plugin
} else {
  npm install --prefix $plugin
}

$harnessBin = Join-Path $root 'apps/deepseek-harness/apps/cli/lib/bin.js'
if (-not (Test-Path -LiteralPath $harnessBin -PathType Leaf)) {
  throw "Harness build did not produce $harnessBin"
}

if ($Global) {
  dsh setup (Join-Path $root 'apps/deepseek-harness')
} else {
  $env:DSH_OFFICIAL_BIN = $harnessBin
  Write-Output "Set DSH_OFFICIAL_BIN for this shell to: $harnessBin"
  Write-Output "Use: node $plugin/src/bin.js cli"
}

Write-Output 'Setup complete.'
