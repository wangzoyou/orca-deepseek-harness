import test from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { Renderer } from '../src/renderer.js'

class Capture extends Writable {
  constructor() {
    super()
    this.text = ''
    this.isTTY = false
    this.columns = 100
  }

  _write(chunk, _encoding, callback) {
    this.text += chunk.toString()
    callback()
  }
}

function createRenderer() {
  const output = new Capture()
  return { output, renderer: new Renderer({ output, errorOutput: output }) }
}

test('agent status emits Orca lifecycle and compatible titles', () => {
  const { output, renderer } = createRenderer()
  renderer.agentStatus('working', 'inspect project')
  renderer.agentStatus('done', 'inspect project')
  assert.match(output.text, /\x1b\]9999;{"state":"working","prompt":"inspect project","agentType":"deepseek-harness"}\x07/)
  assert.match(output.text, /\x1b\]0;DeepSeek Harness working\x07/)
  assert.match(output.text, /\x1b\]9999;{"state":"done"/)
  assert.match(output.text, /\x1b\]0;DeepSeek Harness ready\x07/)
})

test('session list shows the uuid prefix instead of a bare session-', () => {
  const { output, renderer } = createRenderer()
  renderer.sessionList([{
    sessionId: 'session-91e495b8-797d-4fcf-9348-550ed7e397a8',
    title: 'demo',
    running: false,
    blank: false,
    cwd: '/tmp',
  }])
  assert.match(output.text, /91e495b8/)
  assert.doesNotMatch(output.text, /session-91e/)
})

test('banner carries preset and permission rows', () => {
  const { output, renderer } = createRenderer()
  renderer.banner({
    sessionId: 'session-91e495b8-797d-4fcf-9348-550ed7e397a8',
    cwd: '/tmp',
    model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'max' },
    approvalPolicy: 'ask',
    agentPreset: 'standard',
    permission: 'workspace-write',
  })
  assert.match(output.text, /预设 standard/)
  assert.match(output.text, /权限 workspace-write/)
  assert.match(output.text, /91e495b8/)
})

test('status shows plan mode and goal when present', () => {
  const { output, renderer } = createRenderer()
  renderer.status({
    sessionId: 'session-91e495b8-797d-4fcf-9348-550ed7e397a8',
    cwd: '/tmp',
    model: { provider: 'deepseek', model: 'deepseek-chat' },
    routable: true,
    running: false,
    hostVersion: '0.0.1',
    baseUrl: 'http://127.0.0.1:3080/',
    approvalPolicy: 'ask',
    agentPreset: 'standard',
    permission: 'workspace-write',
    planActive: true,
    goal: '修复测试（active）',
  })
  assert.match(output.text, /计划模式/)
  assert.match(output.text, /修复测试（active）/)
})

test('line clears and redraws the pending composer around prints', () => {
  const { output, renderer } = createRenderer()
  let redraws = 0
  renderer.composerLine = () => true
  renderer.composerRedraw = () => { redraws += 1; output.write('PROMPT>') }
  renderer.line('hello')
  assert.equal(redraws, 1)
  assert.ok(output.text.indexOf('hello') < output.text.indexOf('PROMPT>'), 'composer reprints after the output line')
})

test('diff card renders per-file line deltas', () => {
  const { output, renderer } = createRenderer()
  renderer.toolCall('c1', 'edit', '{}', {
    for: 'call',
    view: {
      card: 'diff',
      title: 'x',
      diffs: [
        { path: 'src/a.js', oldText: 'a\nb', newText: 'a\nb\nc' },
        { path: 'src/b.js', oldText: null, newText: 'x\ny' },
      ],
    },
  })
  assert.match(output.text, /✎ src\/a\.js（-2 \+3 行）/)
  assert.match(output.text, /✎ src\/b\.js（新建 2 行）/)
})

test('subagent list renders activity, mode, label, and diagnostic rows', () => {
  const { output, renderer } = createRenderer()
  renderer.subagentList([
    { kind: 'child', id: 'session-aaaa1111-0000-4000-8000-000000000000', mode: 'continuable', activity: 'running', hasChildren: true, label: '探索代码' },
    { kind: 'diagnostic', id: 'session-bbbb2222-0000-4000-8000-000000000000', reason: 'corrupt' },
  ])
  assert.match(output.text, /running/)
  assert.match(output.text, /continuable/)
  assert.match(output.text, /探索代码/)
  assert.match(output.text, /含下级/)
  assert.match(output.text, /corrupt/)
  renderer.subagentList([])
  assert.match(output.text, /当前会话没有子代理/)
})

test('queue list renders placement and message text', () => {
  const { output, renderer } = createRenderer()
  renderer.queueList([
    { id: 'q1', placement: 'queued', message: { content: [{ type: 'text', text: '等我一下' }] } },
    { id: 'q2', placement: 'steering', message: { content: [{ type: 'text', text: '换个方向' }] } },
  ])
  assert.match(output.text, /queued/)
  assert.match(output.text, /steering/)
  assert.match(output.text, /等我一下/)
  assert.match(output.text, /\/queue remove\|steer\|edit/)
  renderer.queueList([])
  assert.match(output.text, /队列是空的/)
})
