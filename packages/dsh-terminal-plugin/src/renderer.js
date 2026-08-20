import { createAnsi } from './ansi.js'
import {
  displayWidth,
  extractTextBlocks,
  fitText,
  formatDuration,
  formatTokens,
  parseJsonObject,
  safeJson,
  shortenPath,
  terminalColumns,
  tokenTotal,
  truncate,
} from './utils.js'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const AGENT_TYPE = 'deepseek-harness'

export class Renderer {
  constructor({ output = process.stdout, errorOutput = process.stderr, verbose = false, debug = false } = {}) {
    this.output = output
    this.errorOutput = errorOutput
    this.ansi = createAnsi(output)
    this.verbose = verbose
    this.debugEnabled = debug
    this.activity = undefined
    this.activityTimer = undefined
    this.activityFrame = 0
    this.activityDrawn = false
    this.quietActivity = undefined
    this.composerLine = undefined
    this.composerRedraw = undefined
    this.assistantStreaming = false
    this.reasoningShown = false
    this.toolStartedAt = new Map()
    this.currentInfo = undefined
  }

  setVerbose(value) {
    this.verbose = Boolean(value)
    this.notice(`工具输出详细模式：${this.verbose ? '开启' : '关闭'}`)
  }

  setDebug(value) {
    this.debugEnabled = Boolean(value)
    this.notice(`调试日志：${this.debugEnabled ? '开启' : '关闭'}`)
  }

  write(text) {
    this.output.write(String(text))
  }

  writeError(text) {
    this.errorOutput.write(String(text))
  }

  agentStatus(state, prompt = '') {
    const payload = JSON.stringify({ state, prompt: String(prompt), agentType: AGENT_TYPE })
    this.write(`\x1b]9999;${payload}\x07`)
    const title = state === 'working' ? 'DeepSeek Harness working' : 'DeepSeek Harness ready'
    this.write(`\x1b]0;${title}\x07`)
  }

  line(text = '') {
    this.clearActivity()
    this.finishAssistantStream()
    // With the composer kept live, discrete prints briefly clear the input
    // row and reprint it afterwards instead of splicing into it.
    const composerActive = this.composerLine?.() === true
    if (composerActive) this.write(`\r${this.ansi.clearLine}`)
    this.write(`${text}\n`)
    if (composerActive) this.composerRedraw?.()
  }

  debug(text) {
    if (!this.debugEnabled) return
    this.line(this.ansi.gray(`[debug] ${text}`))
  }

  banner(info) {
    this.currentInfo = info
    const width = terminalColumns(this.output)
    const inner = width - 4
    const title = ` ${this.ansi.bold(this.ansi.cyan('DeepSeek Harness CLI'))} `
    const plainTitleWidth = displayWidth(' DeepSeek Harness CLI ')
    const top = `╭─${title}${'─'.repeat(Math.max(0, inner - plainTitleWidth + 1))}╮`
    const model = info.model
      ? `${info.model.provider}/${info.model.model}${info.model.reasoningEffort ? ` · ${info.model.reasoningEffort}` : ''}`
      : '未选择模型'
    const cwd = shortenPath(info.cwd)
    const row1 = fitText(`模型 ${model}`, inner)
    const row2 = fitText(`目录 ${cwd}`, inner)
    const row3 = fitText(`会话 ${shortId(info.sessionId)} · 预设 ${info.agentPreset ?? '-'} · 权限 ${info.permission ?? '-'}`, inner)
    const row4 = fitText(`审批 ${approvalLabel(info.approvalPolicy)} · / 唤起命令 · Ctrl+C 取消/双击退出`, inner)
    this.line(top)
    this.line(boxRow(row1, inner))
    this.line(boxRow(row2, inner))
    this.line(boxRow(row3, inner))
    this.line(boxRow(row4, inner))
    this.line(`╰${'─'.repeat(width - 2)}╯`)
  }

  updateHeader(info) {
    this.currentInfo = { ...(this.currentInfo ?? {}), ...info }
  }

  section(text) {
    this.line(this.ansi.bold(this.ansi.cyan(text)))
  }

  notice(text) {
    this.line(`${this.ansi.cyan('·')} ${text}`)
  }

  success(text) {
    this.line(`${this.ansi.green('✓')} ${text}`)
  }

  warning(text) {
    this.line(`${this.ansi.yellow('!')} ${text}`)
  }

  error(text) {
    this.line(`${this.ansi.red('×')} ${text}`)
  }

  user(text) {
    this.clearActivity()
    this.finishAssistantStream()
    const lines = String(text).split('\n')
    this.write(`${this.ansi.bold(this.ansi.blue('›'))} ${lines[0] ?? ''}\n`)
    for (const line of lines.slice(1)) this.write(`  ${line}\n`)
  }

  assistant(text, { history = false } = {}) {
    this.clearActivity()
    this.finishAssistantStream()
    if (text === '') return
    const label = history ? this.ansi.gray('◆ dsh') : this.ansi.bold(this.ansi.magenta('◆ dsh'))
    this.write(`${label}\n`)
    this.write(indentBlock(text, '  '))
    if (!text.endsWith('\n')) this.write('\n')
  }

  assistantDelta(text) {
    if (typeof text !== 'string' || text === '') return
    this.clearActivity()
    if (!this.assistantStreaming) {
      this.finishAssistantStream()
      this.write(`${this.ansi.bold(this.ansi.magenta('◆ dsh'))}\n  `)
      this.assistantStreaming = true
    }
    const value = text.replace(/\n/g, '\n  ')
    this.write(value)
  }

  finishAssistantStream() {
    if (!this.assistantStreaming) return
    this.write('\n')
    this.assistantStreaming = false
  }

  reasoningPulse() {
    if (this.reasoningShown) return
    this.clearActivity()
    this.finishAssistantStream()
    this.line(`${this.ansi.gray('◌')} ${this.ansi.dim('思考中…')}`)
    this.reasoningShown = true
  }

  resetStepPresentation() {
    this.reasoningShown = false
  }

  toolCall(callId, name, rawArguments, view) {
    this.clearActivity()
    this.finishAssistantStream()
    this.toolStartedAt.set(callId, Date.now())
    const detail = summarizeToolCall(name, rawArguments, view)
    this.line(`${this.ansi.cyan(toolIcon(name))} ${this.ansi.bold(name)}${detail ? `  ${this.ansi.dim(detail)}` : ''}`)
    for (const line of diffCardLines(view)) this.line(`  ${this.ansi.dim(line)}`)
  }

  toolResult(callId, { text, error, view } = {}) {
    this.clearActivity()
    this.finishAssistantStream()
    const startedAt = this.toolStartedAt.get(callId)
    this.toolStartedAt.delete(callId)
    const elapsed = startedAt === undefined ? '' : ` · ${formatDuration(Date.now() - startedAt)}`
    const failed = Boolean(error)
    const marker = failed ? this.ansi.red('└─ failed') : this.ansi.green('└─ done')
    this.line(`  ${marker}${this.ansi.dim(elapsed)}`)
    const rendered = summarizeToolResult(text, view, this.verbose)
    if (rendered !== '') {
      for (const line of rendered.split('\n')) this.line(`     ${this.ansi.dim(line)}`)
    }
    for (const line of diffCardLines(view)) this.line(`     ${this.ansi.dim(line)}`)
    if (error) this.line(`     ${this.ansi.red(truncate(error.message ?? error, 300))}`)
  }

  todos(todos) {
    if (!Array.isArray(todos) || todos.length === 0) return
    this.clearActivity()
    this.finishAssistantStream()
    this.line(this.ansi.bold('任务'))
    for (const todo of todos) {
      const mark = todo.status === 'completed' ? this.ansi.green('✓')
        : todo.status === 'in_progress' ? this.ansi.cyan('●') : this.ansi.gray('○')
      this.line(`  ${mark} ${todo.content}`)
    }
  }

  contextNotice(summary) {
    if (!summary) return
    this.line(`${this.ansi.gray('↳')} ${this.ansi.dim(summary)}`)
  }

  turnEnd(reason, { elapsedMs, usage } = {}) {
    this.clearActivity()
    this.finishAssistantStream()
    this.reasoningShown = false
    const kind = reason?.kind ?? 'unknown'
    const ok = kind === 'completed'
    const marker = ok ? this.ansi.green('✓') : kind === 'aborted' ? this.ansi.yellow('■') : this.ansi.red('×')
    const pieces = [reasonLabel(reason)]
    if (Number.isFinite(elapsedMs)) pieces.push(formatDuration(elapsedMs))
    const total = tokenTotal(usage)
    if (total > 0) pieces.push(`${formatTokens(total)} tokens`)
    this.line(`${marker} ${this.ansi.dim(pieces.join(' · '))}`)
  }

  queueStatus(count) {
    if (count > 0) this.notice(`队列中还有 ${count} 条消息`)
  }

  approvalRequest({ toolName, reason }, call) {
    this.clearActivity()
    this.finishAssistantStream()
    this.line(`${this.ansi.yellow('⚠')} ${this.ansi.bold(toolName)} 请求执行权限`)
    if (reason) this.line(`  ${this.ansi.dim(reason)}`)
    if (call) {
      const detail = summarizeToolCall(call.name, call.arguments, call.view)
      if (detail) this.line(`  ${this.ansi.dim(detail)}`)
      for (const line of diffCardLines(call.view)) this.line(`  ${this.ansi.dim(line)}`)
    }
  }

  question(question, index, total) {
    this.clearActivity()
    this.finishAssistantStream()
    const heading = question.header ? `${question.header} · ` : ''
    this.line(`${this.ansi.cyan('?')} ${this.ansi.bold(`${heading}${question.question}`)}${total > 1 ? this.ansi.dim(` (${index + 1}/${total})`) : ''}`)
    if (question.detail) this.line(indentBlock(question.detail, '  ').trimEnd())
    if (Array.isArray(question.options)) {
      question.options.forEach((option, optionIndex) => {
        this.line(`  ${this.ansi.cyan(String(optionIndex + 1))}. ${option.label}${option.description ? ` — ${this.ansi.dim(option.description)}` : ''}`)
      })
    }
  }

  sessionList(items) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('会话')
    if (items.length === 0) {
      this.notice('还没有可恢复的会话')
      return
    }
    items.forEach((item, index) => {
      const title = item.title || '未命名会话'
      const state = item.running ? this.ansi.cyan('running') : item.blank ? this.ansi.gray('blank') : this.ansi.gray('idle')
      const cwd = item.cwd ? shortenPath(item.cwd) : ''
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))}  ${fitText(title, 42)}  ${this.ansi.dim(shortId(item.sessionId))}  ${state}${cwd ? `  ${this.ansi.dim(cwd)}` : ''}`)
    })
  }

  modelList(items, current) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('模型')
    items.forEach((item, index) => {
      const selected = current?.provider === item.provider && current?.model === item.model ? this.ansi.green('●') : ' '
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))} ${selected} ${item.provider}/${item.model}${item.description ? ` — ${this.ansi.dim(item.description)}` : ''}`)
    })
  }

  status(info) {
    const model = info.model ? `${info.model.provider}/${info.model.model}${info.model.reasoningEffort ? ` (${info.model.reasoningEffort})` : ''}` : '未选择'
    this.section('状态')
    this.line(`  会话    ${info.sessionId}`)
    this.line(`  目录    ${shortenPath(info.cwd)}`)
    this.line(`  模型    ${model}`)
    this.line(`  路由    ${info.routable === false ? this.ansi.red('不可用') : this.ansi.green('可用')}`)
    this.line(`  运行    ${info.running ? this.ansi.cyan('是') : '否'}`)
    this.line(`  宿主    ${info.hostVersion ?? 'unknown'} @ ${info.baseUrl}`)
    this.line(`  审批    ${approvalLabel(info.approvalPolicy)}`)
    this.line(`  预设    ${info.agentPreset ?? '-'}`)
    this.line(`  权限    ${info.permission ?? '-'}`)
    this.line(`  计划    ${info.planActive ? this.ansi.cyan('计划模式') : '-'}`)
    if (info.goal) this.line(`  目标    ${info.goal}`)
  }

  help() {
    this.section('本地命令')
    const rows = [
      ['/new [目录]', '创建新会话'],
      ['/resume [会话ID]', '恢复会话；省略 ID 时显示选择器'],
      ['/sessions', '列出最近会话'],
      ['/model [provider/model]', '查看或切换模型'],
      ['/reasoning [级别]', '切换当前模型的推理档位'],
      ['/permission [预设]', '切换会话权限预设（沙箱+审批，同 Web UI 下拉，回合中可切）'],
      ['/preset [id]', '查看或切换 Agent 预设（仅空白会话可切）'],
      ['/approval ask|allow|deny', '本 CLI 如何应答审批询问（不改会话权限）'],
      ['/rename <标题>', '重命名当前会话'],
      ['/fork', '从当前会话最近完整回合分叉'],
      ['/usage', 'token 用量与上下文拆解'],
      ['/search <关键词>', '全文搜索会话并恢复命中'],
      ['/export [会话ID]', '导出会话日志 ZIP 到当前目录'],
      ['/jobs', '显示当前会话的后台任务'],
      ['/agents', '列出当前会话的子代理（只读）'],
      ['/queue [remove|steer|edit] …', '查看或管理排队消息'],
      ['/feedback up|down [备注]', '给最近一条回复打分（👍/👎）'],
      ['/archive [会话ID]', '归档会话，从列表移除（不删数据）'],
      ['/skill [名称] [参数]', '列出或调用技能'],
      ['/verbose on|off', '展开或折叠工具结果'],
      ['/status', '显示连接、模型和会话状态'],
      ['/version', '显示 CLI 与宿主版本'],
      ['/cancel', '取消正在运行的回合'],
      ['/clear', '清屏，不删除会话'],
      ['/exit', '退出'],
    ]
    for (const [command, description] of rows) this.line(`  ${this.ansi.cyan(command.padEnd(30))}${description}`)
    this.line('')
    this.notice('输入 / 唤起命令菜单：↑↓ 选择，Enter 执行或补全，Esc 关闭，Tab 补全参数。Harness 原生命令（/plan、/compact、/goal 等）经命令注册表执行；未知斜杠输入才会发给模型。多行输入：行尾写 \\ 后继续。')
  }

  presetList(presets, currentId) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('Agent 预设')
    presets.forEach((preset, index) => {
      const selected = preset.id === currentId ? this.ansi.green('●') : ' '
      const tags = [preset.isDefault ? '默认' : undefined, preset.trust === 'user' ? '自定义' : undefined, preset.broken ? '损坏' : undefined]
        .filter(Boolean).join(' · ')
      const label = preset.name ? `${preset.name} (${preset.id})` : preset.id
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))} ${selected} ${label}${tags ? ` ${this.ansi.dim(`· ${tags}`)}` : ''}`)
      if (preset.description) this.line(`      ${this.ansi.dim(fitText(preset.description, 72))}`)
    })
  }

  permissionList(view) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('权限预设')
    view.options.forEach((option, index) => {
      const selected = option.value === view.currentValue ? this.ansi.green('●') : ' '
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))} ${selected} ${option.name ?? option.value}${option.description ? ` — ${this.ansi.dim(option.description)}` : ''}`)
    })
    if (view.currentValue && !view.options.some(option => option.value === view.currentValue)) {
      this.line(`  ${this.ansi.dim(`当前为自定义组合：${view.currentValue}，选择任意预设后不可恢复该组合`)}`)
    }
  }

  usage(view = {}) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('用量')
    const tokens = view.tokenUsage ?? {}
    const input = (tokens.uncachedInputTokens ?? 0) + (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0)
    const output = tokens.outputTokens ?? 0
    this.line(`  token   输入 ${formatTokens(input)}（缓存读 ${formatTokens(tokens.cacheReadTokens ?? 0)} · 写 ${formatTokens(tokens.cacheWriteTokens ?? 0)}） · 输出 ${formatTokens(output)} · 合计 ${formatTokens(input + output)}`)
    const stats = view.sessionStats ?? {}
    this.line(`  会话    回合 ${stats.turns ?? 0} · 步骤 ${stats.steps ?? 0} · 模型 ${formatDuration(stats.llmMs ?? 0)} · 工具 ${formatDuration(stats.toolMs ?? 0)}`)
    const context = view.contextBreakdown ?? {}
    this.line(`  上下文  系统 ${formatTokens(context.systemTokens ?? 0)} · 工具 ${formatTokens(context.toolsTokens ?? 0)} · 消息 ${formatTokens(context.messageTokens ?? 0)}`)
  }

  searchList(items, hasMore) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('搜索命中')
    items.forEach((item, index) => {
      const title = item.title || '未命名会话'
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))}  ${fitText(title, 32)}  ${this.ansi.dim(shortId(item.sessionId))}`)
      if (item.snippet) this.line(`      ${this.ansi.dim(fitText(item.snippet, 72))}`)
    })
    if (hasMore) this.notice('命中过多，只显示前 20 条；换个更具体的关键词试试')
  }

  jobsList(jobs) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('后台任务')
    if (!Array.isArray(jobs) || jobs.length === 0) {
      this.notice('当前会话没有后台任务')
      return
    }
    jobs.forEach(job => {
      const status = String(job?.status ?? 'unknown')
      const colored = status === 'running' ? this.ansi.cyan(status)
        : ['failed', 'error'].includes(status) ? this.ansi.red(status)
          : this.ansi.gray(status)
      const elapsed = Number.isFinite(job?.startedAt)
        ? ` · ${formatDuration((Number.isFinite(job?.endedAt) ? job.endedAt : Date.now()) - job.startedAt)}`
        : ''
      this.line(`  ${colored}  ${job?.label ?? job?.kind ?? job?.id}${this.ansi.dim(elapsed)}`)
      if (job?.detail) this.line(`      ${this.ansi.dim(fitText(String(job.detail), 72))}`)
    })
  }

  skillList(skills) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('技能')
    skills.forEach((skill, index) => {
      const userOnly = skill.modelInvocable === false ? this.ansi.dim(' · 仅用户') : ''
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))}  /${skill.name}${userOnly}${skill.description ? ` — ${this.ansi.dim(fitText(skill.description, 56))}` : ''}`)
    })
  }

  subagentList(entries) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('子代理')
    if (!Array.isArray(entries) || entries.length === 0) {
      this.notice('当前会话没有子代理')
      return
    }
    entries.forEach((entry, index) => {
      const number = this.ansi.cyan(String(index + 1).padStart(2))
      if (entry.kind === 'diagnostic') {
        this.line(`  ${number}  ${this.ansi.red('无法读取')}  ${this.ansi.dim(shortId(entry.id))}  ${this.ansi.dim(entry.reason)}`)
        return
      }
      const activity = entry.activity === 'running' ? this.ansi.cyan('running') : this.ansi.gray('inactive')
      const mode = this.ansi.dim(entry.mode ?? '')
      const label = entry.label ? `  ${fitText(entry.label, 40)}` : ''
      const children = entry.hasChildren ? this.ansi.dim('  · 含下级') : ''
      this.line(`  ${number}  ${activity}  ${mode}  ${this.ansi.dim(shortId(entry.id))}${label}${children}`)
    })
  }

  queueList(items) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('排队消息')
    if (!Array.isArray(items) || items.length === 0) {
      this.notice('队列是空的')
      return
    }
    items.forEach((item, index) => {
      const placement = item.placement === 'steering' ? this.ansi.cyan('steering')
        : item.placement === 'context' ? this.ansi.gray('context')
          : 'queued'
      const text = extractTextBlocks(item.message?.content) || '(非文本消息)'
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))}  ${placement}  ${fitText(text, 60)}`)
    })
    this.notice('用 /queue remove|steer|edit <编号> [新文本] 管理')
  }

  workspaceList(workspaces) {
    this.clearActivity()
    this.finishAssistantStream()
    this.section('工作区')
    workspaces.forEach((workspace, index) => {
      const path = workspace.path ?? workspace.cwd ?? ''
      const title = workspace.title && workspace.title !== path ? `${workspace.title}  ${this.ansi.dim(path)}` : path
      this.line(`  ${this.ansi.cyan(String(index + 1).padStart(2))}  ${fitText(title, 60)}`)
    })
  }

  activityStart(label) {
    this.activityStop()
    this.activity = label
    this.activityFrame = 0
    this.activityDrawn = false
    // A pending composer keeps its line: the stream itself shows the turn is
    // alive, so the spinner stays quiet instead of painting over the prompt.
    if (this.quietActivity?.()) return
    if (!this.output.isTTY || !this.ansi.enabled) {
      this.line(`${this.ansi.gray('·')} ${label}`)
      this.activityDrawn = true
      return
    }
    this.renderActivity()
    this.activityDrawn = true
    this.activityTimer = setInterval(() => {
      this.activityFrame = (this.activityFrame + 1) % SPINNER.length
      this.renderActivity()
    }, 90)
    this.activityTimer.unref?.()
  }

  activityUpdate(label) {
    this.activity = label
    if (this.quietActivity?.()) return
    if (this.output.isTTY && this.ansi.enabled) this.renderActivity()
  }

  activityStop(finalText) {
    if (this.activityTimer !== undefined) clearInterval(this.activityTimer)
    this.activityTimer = undefined
    if (this.activity !== undefined && this.activityDrawn && this.output.isTTY && this.ansi.enabled) {
      this.write(`${this.ansi.cursorStart}${this.ansi.clearLine}`)
    }
    this.activity = undefined
    this.activityDrawn = false
    if (finalText) this.line(finalText)
  }

  clearActivity() {
    this.activityStop()
  }

  renderActivity() {
    if (this.activity === undefined) return
    const glyph = this.ansi.cyan(SPINNER[this.activityFrame])
    this.write(`${this.ansi.cursorStart}${this.ansi.clearLine}${glyph} ${this.ansi.dim(this.activity)}`)
  }

  clearScreen() {
    this.clearActivity()
    this.finishAssistantStream()
    if (this.ansi.enabled) this.write(this.ansi.clearScreen)
    else this.line('\n'.repeat(3))
  }

  close() {
    this.activityStop()
    this.finishAssistantStream()
    if (this.ansi.enabled) this.write(this.ansi.showCursor)
  }
}

function boxRow(text, inner) {
  const pad = Math.max(0, inner - displayWidth(text))
  return `│ ${text}${' '.repeat(pad)} │`
}

function shortId(value) {
  const text = String(value ?? '')
  const bare = text.startsWith('session-') ? text.slice('session-'.length) : text
  return bare.length <= 8 ? bare : bare.slice(0, 8)
}

function indentBlock(text, prefix) {
  return String(text).split('\n').map(line => `${prefix}${line}`).join('\n')
}

function approvalLabel(policy) {
  if (policy === 'allow') return '自动允许'
  if (policy === 'deny') return '自动拒绝'
  return '逐次询问'
}

function reasonLabel(reason) {
  switch (reason?.kind) {
    case 'completed': return '完成'
    case 'aborted': return '已取消'
    case 'blocked': return '被阻止'
    case 'max-tokens': return '达到输出上限'
    case 'interrupted': return '进程中断'
    case 'error': return reason.error?.message ? `失败：${truncate(reason.error.message, 120)}` : '失败'
    default: return `结束：${reason?.kind ?? 'unknown'}`
  }
}

function toolIcon(name) {
  const value = String(name).toLowerCase()
  if (value.includes('bash') || value.includes('shell') || value.includes('pwsh') || value.includes('terminal')) return '$'
  if (value.includes('search') || value.includes('grep') || value.includes('find')) return '⌕'
  if (value.includes('read') || value.includes('file') || value.includes('edit') || value.includes('write')) return '▤'
  if (value.includes('web') || value.includes('http')) return '◎'
  if (value.includes('agent')) return '◇'
  return '◆'
}

function summarizeToolCall(name, rawArguments, view) {
  const viewSummary = readViewSummary(view)
  if (viewSummary) return truncate(viewSummary, 220)
  const parsed = parseJsonObject(rawArguments)
  if (!parsed) return truncate(rawArguments, 220)
  const lower = String(name).toLowerCase()
  const preferredKeys = lower.includes('bash') || lower.includes('shell') || lower.includes('pwsh')
    ? ['command', 'cmd', 'script']
    : lower.includes('file') || lower.includes('read') || lower.includes('edit') || lower.includes('write')
      ? ['path', 'file', 'filename']
      : lower.includes('search') ? ['query', 'pattern', 'path'] : []
  for (const key of preferredKeys) {
    if (typeof parsed[key] === 'string') return truncate(parsed[key], 220)
  }
  return safeJson(parsed, 220)
}

function readViewSummary(view) {
  if (!view || typeof view !== 'object') return undefined
  const candidate = view.view ?? view
  for (const key of ['summary', 'title', 'label', 'command', 'path']) {
    if (typeof candidate[key] === 'string' && candidate[key].trim() !== '') return candidate[key]
  }
  return undefined
}

/**
 * Compact lines for a `card:'diff'` ToolEventView: one per file with line
 * deltas. Full old/new texts stay on the host; the terminal shows the shape
 * of the change, not the whole patch.
 */
function diffCardLines(view, { maxFiles = 5 } = {}) {
  const candidate = view?.view ?? view
  if (candidate?.card !== 'diff' || !Array.isArray(candidate.diffs)) return []
  const lines = candidate.diffs.slice(0, maxFiles).map(diff => {
    const newLines = typeof diff.newText === 'string' ? diff.newText.split('\n').length : 0
    if (diff.oldText === null || diff.oldText === undefined) return `✎ ${diff.path}（新建 ${newLines} 行）`
    const oldLines = String(diff.oldText).split('\n').length
    return `✎ ${diff.path}（-${oldLines} +${newLines} 行）`
  })
  if (candidate.diffs.length > maxFiles) lines.push(`… 共 ${candidate.diffs.length} 个文件`)
  return lines
}

function summarizeToolResult(text, view, verbose) {
  const viewSummary = readViewSummary(view)
  const source = viewSummary || String(text ?? '')
  if (source.trim() === '') return ''
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (verbose || lines.length <= 8) return lines.map(line => truncate(line, 240)).join('\n')
  const head = lines.slice(0, 6).map(line => truncate(line, 240))
  head.push(`… 省略 ${lines.length - 6} 行（/verbose on 展开）`)
  return head.join('\n')
}
