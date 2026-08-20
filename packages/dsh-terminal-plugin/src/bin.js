#!/usr/bin/env node

import { routeArguments, wrapperHelp } from './args.js'
import { runCli } from './cli.js'
import { delegateOfficial } from './official-dsh.js'
import { runSetup } from './setup.js'
import { TARGET_HARNESS_VERSION, packageVersion } from './utils.js'

async function main() {
  let invocation
  try {
    invocation = routeArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    process.stderr.write('运行 dsh help 查看用法。\n')
    return 2
  }

  switch (invocation.kind) {
    case 'help':
      process.stdout.write(`${wrapperHelp()}\n`)
      return 0
    case 'version':
      process.stdout.write(`dsh-terminal-plugin ${packageVersion()} (Harness protocol ${TARGET_HARNESS_VERSION})\n`)
      return 0
    case 'delegate':
      return delegateOfficial(invocation.args)
    case 'setup':
      return runSetup(invocation.args)
    case 'cli':
      return runCli(invocation.options)
    default:
      throw new Error(`Unhandled invocation ${String(invocation.kind)}`)
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`dsh: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
