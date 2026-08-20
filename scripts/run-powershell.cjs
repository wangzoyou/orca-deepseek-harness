const { spawnSync } = require('node:child_process');

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/run-powershell.cjs <script.ps1> [args...]');
  process.exit(2);
}

const candidates = process.platform === 'win32'
  ? ['pwsh', 'powershell']
  : ['pwsh'];
let command;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!probe.error && probe.status === 0) {
    command = candidate;
    break;
  }
}

if (!command) {
  console.error(`PowerShell is required to run ${script}. Install PowerShell 7 (pwsh) or use Windows PowerShell.`);
  process.exit(1);
}

const result = spawnSync(command, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(3)], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
