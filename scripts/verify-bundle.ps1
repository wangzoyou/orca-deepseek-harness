$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$required = @(
  'apps/orca/package.json',
  'apps/orca/src/shared/tui-agent-config.ts',
  'apps/orca/src/main/ai-vault/session-scanner-deepseek-parser.ts',
  'apps/deepseek-harness/package.json',
  'apps/deepseek-harness/LICENSE',
  'packages/dsh-terminal-plugin/package.json',
  'packages/dsh-terminal-plugin/src/bin.js',
  'packages/dsh-terminal-plugin/src/renderer.js',
  'BUNDLE_MANIFEST.json'
)

foreach ($relative in $required) {
  $path = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing required bundle file: $relative"
  }
}

$scanRoots = @(
  (Join-Path $root 'apps'),
  (Join-Path $root 'packages'),
  (Join-Path $root 'scripts')
)
$forbidden = Get-ChildItem -LiteralPath $scanRoots -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object {
    $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    $relative -match '(^|/)node_modules/' -or
    $relative -match '(^|/)\.git/' -or
    $relative -match '^apps/orca/(out|dist|dist-electron|release|build)/' -or
    $relative -match '^apps/deepseek-harness/(lib|dist-exe|\.sessions|\.storages|worktrees)/' -or
    $relative -match '^apps/deepseek-harness/apps/[^/]+/(lib|dist)/' -or
    $relative -match 'session\.jsonl\.zstd$' -or
    $_.Name -match '^\.env($|\.)|\.log$|\.tsbuildinfo$'
  }
if ($forbidden) {
  $names = ($forbidden | Select-Object -First 20 -ExpandProperty FullName) -join [Environment]::NewLine
  throw "Generated, secret, or local-state files are present in the bundle:`n$names"
}

$orcaConfig = Get-Content -Raw (Join-Path $root 'apps/orca/src/shared/tui-agent-config.ts')
if ($orcaConfig -notmatch "'deepseek-harness'") {
  throw 'Orca is missing the deepseek-harness agent configuration.'
}

$parser = Get-Content -Raw (Join-Path $root 'apps/orca/src/main/ai-vault/session-scanner-deepseek-parser.ts')
if ($parser -notmatch 'zstdDecompressSync' -or $parser -notmatch 'bytesWritten') {
  throw 'Orca DSH parser is missing concatenated zstd frame support.'
}

Write-Output 'Bundle structure is valid.'
