import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const required = [
  'apps/orca/package.json',
  'apps/orca/src/shared/tui-agent-config.ts',
  'apps/orca/src/main/ai-vault/session-scanner-deepseek-parser.ts',
  'apps/deepseek-harness/package.json',
  'apps/deepseek-harness/LICENSE',
  'packages/dsh-terminal-plugin/package.json',
  'packages/dsh-terminal-plugin/src/bin.js',
  'packages/dsh-terminal-plugin/src/renderer.js',
  'BUNDLE_MANIFEST.json',
];

for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Missing required bundle file: ${relative}`);
  }
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const forbidden = [];
for (const base of ['apps', 'packages', 'scripts']) {
  for (const file of walk(path.join(root, base))) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const basename = path.basename(file);
    if (
      /(^|\/)node_modules\//.test(relative) ||
      /(^|\/)\.git\//.test(relative) ||
      /^apps\/orca\/(out|dist|dist-electron|release|build)\//.test(relative) ||
      /^apps\/deepseek-harness\/(lib|dist-exe|\.sessions|\.storages|worktrees)\//.test(relative) ||
      /^apps\/deepseek-harness\/apps\/[^/]+\/(lib|dist)\//.test(relative) ||
      /session\.jsonl\.zstd$/.test(relative) ||
      /^\.env(?:\.|$)/.test(basename) ||
      /\.log$/.test(basename) ||
      /\.tsbuildinfo$/.test(basename)
    ) {
      forbidden.push(file);
    }
  }
}

if (forbidden.length > 0) {
  const sample = forbidden.slice(0, 20).join('\n');
  throw new Error(`Generated, secret, or local-state files are present in the bundle:\n${sample}`);
}

const config = fs.readFileSync(path.join(root, 'apps/orca/src/shared/tui-agent-config.ts'), 'utf8');
if (!config.includes("'deepseek-harness'")) {
  throw new Error('Orca is missing the deepseek-harness agent configuration.');
}

const parser = fs.readFileSync(
  path.join(root, 'apps/orca/src/main/ai-vault/session-scanner-deepseek-parser.ts'),
  'utf8',
);
if (!parser.includes('zstdDecompressSync') || !parser.includes('bytesWritten')) {
  throw new Error('Orca DSH parser is missing concatenated zstd frame support.');
}

console.log('Bundle structure is valid.');
