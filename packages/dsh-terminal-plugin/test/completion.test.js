import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompleter, slashEntries } from '../src/completion.js'

function controllerStub(overrides = {}) {
  return {
    hostCommands: [{ name: 'plan' }, { name: 'compact' }],
    skills: [],
    modelOptions: () => [{ provider: 'deepseek', model: 'deepseek-chat' }],
    reasoningOptions: () => ({ efforts: [{ id: 'high' }, { id: 'max' }] }),
    permissionView: () => ({ options: [{ value: 'read-only' }, { value: 'workspace-write' }] }),
    listAgentPresets: async () => ({ presets: [{ id: 'standard' }, { id: 'code' }] }),
    listSessions: async () => [{ sessionId: 'session-abc' }],
    ...overrides,
  }
}

test('slash alone lists every local and host command', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  const [matches, word] = await complete('/')
  assert.ok(matches.includes('/model'))
  assert.ok(matches.includes('/permission'))
  assert.ok(matches.includes('/preset'))
  assert.ok(matches.includes('/plan'), 'host commands merge into candidates')
  assert.equal(word, '/')
})

test('command names filter by prefix', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  const [matches, word] = await complete('/mo')
  // /model takes a completable argument, so the sole match carries a space.
  assert.deepEqual(matches, ['/model '])
  assert.equal(word, '/mo')
})

test('sole match without arguments completes bare', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  const [matches] = await complete('/sess')
  assert.deepEqual(matches, ['/sessions'])
})

test('argument completion uses the declared source', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  assert.deepEqual(await complete('/permission '), [['read-only', 'workspace-write'], ''])
  assert.deepEqual(await complete('/permission re'), [['read-only'], 're'])
  assert.deepEqual(await complete('/reasoning m'), [['max'], 'm'])
  assert.deepEqual(await complete('/model deepseek/deepseek-c'), [['deepseek/deepseek-chat'], 'deepseek/deepseek-c'])
  assert.deepEqual(await complete('/approval as'), [['ask'], 'as'])
  assert.deepEqual(await complete('/preset c'), [['code'], 'c'])
})

test('non-slash input is not completed', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  assert.deepEqual(await complete('hello'), [[], 'hello'])
})

test('free-text and unknown commands offer no argument completion', async () => {
  const complete = createCompleter({ controller: controllerStub() })
  assert.deepEqual(await complete('/rename tit'), [[], '/rename tit'])
  assert.deepEqual(await complete('/plan on'), [[], '/plan on'])
})

test('skills merge into menu entries and /skill argument completion', async () => {
  const controller = controllerStub({ skills: [{ name: 'code-style', description: '代码风格' }] })
  const entries = slashEntries(controller)
  assert.ok(entries.some(entry => entry.name === '/code-style' && entry.description.includes('技能')))
  const complete = createCompleter({ controller })
  assert.deepEqual(await complete('/skill code'), [['code-style'], 'code'])
})
