# Orca + DeepSeek Harness Bundle

This repository packages the complete tested integration of:

- Orca, the multi-agent workspace and orchestration desktop application.
- DeepSeek Harness, the official agent runtime.
- `dsh-terminal-plugin`, the interactive terminal front door that Orca launches and recognizes.

The bundle includes the Orca DeepSeek integration: process recognition, terminal status OSC events, AI Vault history scanning, concatenated zstd session parsing, session resume commands, and supervised Orca `worker_done` orchestration.

## Quick Start

Requirements:

- Windows, macOS, or Linux.
- Node.js `22.19+` or `24+`.
- `pnpm` 11 for Orca and DeepSeek Harness.
- `npm` for the DSH terminal plugin.

Clone this repository, then run the setup command for your platform:

```powershell
npm run setup:windows
```

```sh
sh scripts/setup.sh
```

The setup script installs dependencies, builds the official Harness CLI, and configures the local TUI wrapper to use the bundled Harness build. Use `npm run setup:windows -- -Global` on Windows or `sh scripts/setup.sh --global` on Unix when you want the `dsh` command installed globally.

After setup:

```sh
dsh cli
```

Orca development mode:

```sh
pnpm --dir apps/orca dev
```

When Orca creates a DeepSeek worker, it launches `dsh cli`. For a supervised orchestration task that must call back through Orca's Windows named pipe, use:

```sh
dsh cli --approval allow
```

The default DSH approval mode is `ask`. `allow` applies only to the current CLI process and is required for a worker to execute its Orca lifecycle callback inside a confined Windows shell.

## Verification

Run the repository structure and TUI checks:

```sh
npm test
```

Run the Orca integration checks after dependencies are installed:

```sh
pnpm run typecheck:orca
pnpm run test:orca-dsh
pnpm run build:orca
```

The DSH session scanner reads `session.jsonl.zstd` files under `DSH_HOME/sessions` or `~/.dsh/sessions`. DSH appends each event as a separate zstd frame, so the bundled parser intentionally decompresses concatenated frames rather than only the first frame.

## Layout

```text
apps/orca/                  Orca source plus DeepSeek integration
apps/deepseek-harness/      Official DeepSeek Harness source
packages/dsh-terminal-plugin Interactive `dsh` TUI and Orca terminal protocol
scripts/setup.ps1           Windows setup
scripts/setup.sh            macOS/Linux setup
scripts/verify-bundle.ps1   Source and required-file verification
BUNDLE_MANIFEST.json        Upstream commits and integration contract
```

## Source and Licensing

See `BUNDLE_MANIFEST.json` for exact upstream commits and `THIRD_PARTY_NOTICES.md` for redistribution notices. Each component's original MIT `LICENSE` file remains in its component directory.

中文说明见 [`README.zh-CN.md`](README.zh-CN.md)。
