import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCliOptions, routeArguments } from '../src/args.js'

test('bare dsh enters the interactive CLI', () => {
  const invocation = routeArguments([])
  assert.equal(invocation.kind, 'cli')
  assert.equal(invocation.options.approvalPolicy, 'ask')
})

test('official commands and launcher flags are delegated unchanged', () => {
  assert.deepEqual(routeArguments(['web', '--port', '0']), {
    kind: 'delegate',
    args: ['web', '--port', '0'],
  })
  assert.deepEqual(routeArguments(['--profile', 'headless', 'task']), {
    kind: 'delegate',
    args: ['--profile', 'headless', 'task'],
  })
})

test('setup is handled by the wrapper without booting Harness', () => {
  assert.deepEqual(routeArguments(['setup', '/tmp/harness']), {
    kind: 'setup',
    args: ['/tmp/harness'],
  })
})

test('positional text becomes the first prompt', () => {
  const invocation = routeArguments(['fix', 'the', 'tests'])
  assert.equal(invocation.kind, 'cli')
  assert.equal(invocation.options.initialPrompt, 'fix the tests')
})

test('CLI options parse values, equals syntax, and trailing prompt', () => {
  const options = parseCliOptions([
    '--connect=http://127.0.0.1:3080',
    '--approval', 'allow',
    '--model', 'deepseek/deepseek-chat',
    '--reasoning=high',
    '--no-history',
    'inspect', 'this', 'repo',
  ])
  assert.equal(options.connect, 'http://127.0.0.1:3080')
  assert.equal(options.approvalPolicy, 'allow')
  assert.equal(options.model, 'deepseek/deepseek-chat')
  assert.equal(options.reasoning, 'high')
  assert.equal(options.showHistory, false)
  assert.equal(options.initialPrompt, 'inspect this repo')
})

test('invalid approval policy is rejected', () => {
  assert.throws(() => parseCliOptions(['--approval', 'always']), /ask、allow 或 deny/)
})
