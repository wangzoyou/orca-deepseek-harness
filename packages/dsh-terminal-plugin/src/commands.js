import { TARGET_HARNESS_VERSION, packageVersion, parseProviderModel, splitShellWords } from './utils.js'

/**
 * Local command registry: the single source for routing, /help rows, and
 * composer completion candidates. `hint` documents the argument; `completeArg`
 * names the controller-backed candidate source completion.js uses for TAB.
 */
export const LOCAL_COMMANDS = {
  '/help': { description: '显示帮助' },
  '/exit': { description: '退出' },
  '/new': { description: '创建新会话', hint: '[目录]' },
  '/resume': { description: '恢复会话；省略 ID 时显示选择器', hint: '[会话ID]', completeArg: 'session' },
  '/sessions': { description: '列出最近会话' },
  '/model': { description: '查看或切换模型', hint: '[provider/model]', completeArg: 'model' },
  '/reasoning': { description: '切换当前模型的推理档位', hint: '[级别]', completeArg: 'reasoning' },
  '/permission': { description: '切换会话权限预设（同 Web UI 下拉，回合中可切）', hint: '[预设]', completeArg: 'permission' },
  '/preset': { description: '查看或切换 Agent 预设（仅空白会话可切）', hint: '[id]', completeArg: 'preset' },
  '/approval': { description: '本 CLI 如何应答审批询问（不改会话权限）', hint: 'ask|allow|deny', completeArg: 'approval' },
  '/rename': { description: '重命名当前会话', hint: '<标题>' },
  '/fork': { description: '从当前会话最近完整回合分叉' },
  '/usage': { description: 'token 用量与上下文拆解' },
  '/search': { description: '全文搜索会话内容并恢复命中会话', hint: '<关键词>' },
  '/export': { description: '导出会话日志 ZIP 到当前目录', hint: '[会话ID]', completeArg: 'session' },
  '/jobs': { description: '显示当前会话的后台任务' },
  '/agents': { description: '列出当前会话的子代理（只读）' },
  '/queue': { description: '查看或管理排队消息', hint: '[remove|steer|edit] [编号] [新文本]', completeArg: 'queue' },
  '/feedback': { description: '给最近一条回复打分（👍/👎）', hint: 'up|down [备注]', completeArg: 'feedback' },
  '/archive': { description: '归档会话，从列表移除（不删数据）', hint: '[会话ID]', completeArg: 'session' },
  '/skill': { description: '列出或调用技能（skill）', hint: '[名称] [参数]', completeArg: 'skill' },
  '/verbose': { description: '展开或折叠工具结果', hint: 'on|off', completeArg: 'onoff' },
  '/debug': { description: '显示协议调试信息', hint: 'on|off', completeArg: 'onoff' },
  '/status': { description: '显示连接、模型和会话状态' },
  '/version': { description: '显示 CLI 与宿主版本' },
  '/cancel': { description: '取消正在运行的回合' },
  '/clear': { description: '清屏，不删除会话' },
}

const COMMAND_ALIASES = {
  '/?': '/help',
  '/quit': '/exit',
}

export class CommandRouter {
  constructor({ controller, renderer, input } = {}) {
    this.controller = controller
    this.renderer = renderer
    this.input = input
  }

  async handle(text) {
    if (!String(text).startsWith('/')) return { handled: false }
    const words = splitShellWords(String(text))
    let command = words.shift()?.toLowerCase()
    if (!command) return { handled: false }
    if (command === '/') {
      this.renderer.help()
      return { handled: true }
    }
    command = COMMAND_ALIASES[command] ?? command
    if (!Object.hasOwn(LOCAL_COMMANDS, command)) {
      // Harness-native commands (/plan, /goal, /compact, /swarm, …) must go
      // through the commands registry — session.prompt delivers them to the
      // model as plain text. Only truly unknown slash input falls through
      // to a prompt (skill commands live outside the registry).
      if (this.controller.hostCommands?.some(descriptor => `/${descriptor?.name}` === command)) {
        await this.hostCommand(String(text).trim())
        return { handled: true }
      }
      return { handled: false }
    }

    switch (command) {
      case '/help':
        this.renderer.help()
        return { handled: true }
      case '/exit':
        return { handled: true, exit: true }
      case '/new':
        await this.newSession(words)
        return { handled: true }
      case '/sessions':
        await this.showSessions()
        return { handled: true }
      case '/resume':
        await this.resume(words[0])
        return { handled: true }
      case '/model':
        await this.model(words)
        return { handled: true }
      case '/reasoning':
        await this.reasoning(words[0])
        return { handled: true }
      case '/permission':
        await this.permission(words[0])
        return { handled: true }
      case '/preset':
        await this.preset(words[0])
        return { handled: true }
      case '/rename': {
        const title = words.join(' ').trim()
        if (title === '') throw new Error('用法：/rename <标题>')
        await this.controller.rename(title)
        return { handled: true }
      }
      case '/fork':
        await this.controller.fork()
        return { handled: true }
      case '/usage':
        this.renderer.usage(this.controller.usageView())
        return { handled: true }
      case '/search':
        await this.search(words)
        return { handled: true }
      case '/export': {
        const { path, bytes } = await this.controller.exportSession(words[0])
        this.renderer.success(`会话日志已导出：${path}（${bytes} 字节）`)
        return { handled: true }
      }
      case '/jobs':
        this.renderer.jobsList(this.controller.jobs)
        return { handled: true }
      case '/agents': {
        const { entries } = await this.controller.listSubagents()
        this.renderer.subagentList(entries)
        return { handled: true }
      }
      case '/queue':
        await this.queue(words)
        return { handled: true }
      case '/feedback':
        await this.feedback(words)
        return { handled: true }
      case '/archive':
        await this.archive(words[0])
        return { handled: true }
      case '/skill':
        await this.skill(words)
        return { handled: true }
      case '/version': {
        const host = this.controller.hostDescription?.version ?? 'unknown'
        this.renderer.notice(`dsh-terminal-plugin ${packageVersion()} · 协议 ${TARGET_HARNESS_VERSION} · 宿主 ${host}`)
        return { handled: true }
      }
      case '/approval':
        this.approval(words[0])
        return { handled: true }
      case '/verbose':
        this.toggleRenderer('verbose', words[0])
        return { handled: true }
      case '/debug':
        this.toggleRenderer('debug', words[0])
        return { handled: true }
      case '/status':
        this.renderer.status(this.controller.statusInfo())
        return { handled: true }
      case '/cancel': {
        const cancelled = await this.controller.cancel()
        if (!cancelled) this.renderer.notice('当前没有正在运行的回合')
        return { handled: true }
      }
      case '/clear':
        this.renderer.clearScreen()
        this.renderer.banner(this.controller.statusInfo())
        return { handled: true }
      default:
        return { handled: false }
    }
  }

  async showSessions() {
    const sessions = await this.controller.listSessions()
    this.renderer.sessionList(sessions.slice(0, 50))
    return sessions
  }

  /**
   * /new: with an argument it stays a plain path; without one it mirrors the
   * web composer's workspace dropdown and offers known workspaces.
   */
  async newSession(words) {
    if (words.length > 0) {
      await this.controller.newSession(words.join(' '))
      return
    }
    let workspaces = []
    try {
      workspaces = await this.controller.listWorkspaces()
    } catch {
      workspaces = []
    }
    if (workspaces.length === 0) {
      await this.controller.newSession(this.controller.cwd)
      return
    }
    this.renderer.workspaceList(workspaces)
    const index = await this.input.choose('新会话用哪个目录？[0 当前目录] › ', workspaces.length, {
      allowZero: true,
      context: 'workspace-choice',
    })
    const target = index === undefined ? this.controller.cwd : (workspaces[index].path ?? this.controller.cwd)
    await this.controller.newSession(target)
  }

  async resume(requested) {
    const sessions = await this.controller.listSessions()
    if (sessions.length === 0) {
      this.renderer.notice('还没有可恢复的会话')
      return
    }
    let session
    if (requested) {
      const exact = sessions.find(item => item.sessionId === requested)
      const prefixed = sessions.filter(item => String(item.sessionId).startsWith(requested))
      if (exact) session = exact
      else if (prefixed.length === 1) session = prefixed[0]
      else if (prefixed.length > 1) throw new Error(`会话前缀 ${requested} 不唯一，请多输入几位`)
      else throw new Error(`找不到会话 ${requested}`)
    } else {
      this.renderer.sessionList(sessions.slice(0, 50))
      const index = await this.input.choose('恢复哪一个？[0 取消] › ', Math.min(sessions.length, 50), {
        allowZero: true,
        context: 'session-choice',
      })
      if (index === undefined) return
      session = sessions[index]
    }
    await this.controller.switchSession(session.sessionId, { showHistory: true })
  }

  async model(words) {
    await this.controller.refreshModels()
    if (words.length > 0) {
      const selection = parseProviderModel(words[0])
      await this.controller.selectModel(selection.provider, selection.model, words[1])
      return
    }
    const options = this.controller.modelOptions()
    if (options.length === 0) throw new Error('Harness 没有返回可选模型；请先检查模型提供方配置')
    this.renderer.modelList(options, this.controller.model)
    const index = await this.input.choose('切换到哪个模型？[0 取消] › ', options.length, {
      allowZero: true,
      context: 'model-choice',
    })
    if (index === undefined) return
    const chosen = options[index]
    const reasoningEffort = await this.chooseReasoning(chosen.reasoning, { allowKeepDefault: true })
    await this.controller.selectModel(chosen.provider, chosen.model, reasoningEffort)
  }

  async reasoning(requested) {
    await this.controller.refreshModels()
    const current = this.controller.model
    if (!current) throw new Error('当前会话还没有模型选择')
    const reasoning = this.controller.reasoningOptions(current.provider, current.model)
    const efforts = reasoning?.efforts ?? []
    if (efforts.length === 0) throw new Error(`模型 ${current.provider}/${current.model} 没有公开可选推理档位`)
    let effort = requested
    if (!effort) effort = await this.chooseReasoning(reasoning, { allowKeepDefault: false })
    if (!effort) return
    const known = efforts.find(item => item.id === effort)
    if (!known) throw new Error(`未知推理档位 ${effort}；可选：${efforts.map(item => item.id).join('、')}`)
    await this.controller.selectModel(current.provider, current.model, effort)
  }

  async chooseReasoning(reasoning, { allowKeepDefault }) {
    const efforts = reasoning?.efforts ?? []
    if (efforts.length === 0) return undefined
    this.renderer.section('推理档位')
    efforts.forEach((effort, index) => {
      const isDefault = reasoning.defaultEffort === effort.id
      this.renderer.line(`  ${this.renderer.ansi.cyan(String(index + 1).padStart(2))}  ${effort.name} (${effort.id})${isDefault ? this.renderer.ansi.dim(' · 默认') : ''}${effort.description ? ` — ${this.renderer.ansi.dim(effort.description)}` : ''}`)
    })
    const prompt = allowKeepDefault ? '推理档位？[0 使用默认] › ' : '推理档位？[0 取消] › '
    const index = await this.input.choose(prompt, efforts.length, {
      allowZero: true,
      context: 'reasoning-choice',
    })
    return index === undefined ? undefined : efforts[index].id
  }

  /**
   * The session's real permission preset (sandbox mode + approval policy, the
   * same selector the web composer shows) switched through the Harness
   * commands registry — distinct from /approval, which only decides how this
   * CLI answers approval prompts. Allowed mid-turn, like the web dropdown.
   */
  async permission(requested) {
    const view = this.controller.permissionView()
    const options = Array.isArray(view?.options) ? view.options : []
    if (options.length === 0) throw new Error('宿主没有公开权限预设选择器')
    let name = requested
    if (!name) {
      this.renderer.permissionList({ ...view, options })
      const index = await this.input.choose('切换到哪个权限预设？[0 取消] › ', options.length, {
        allowZero: true,
        context: 'permission-choice',
      })
      if (index === undefined) return
      name = options[index].value
    }
    if (!options.some(option => option.value === name)) {
      throw new Error(`未知权限预设 ${name}；可选：${options.map(option => option.value).join('、')}`)
    }
    if (name === view.currentValue) {
      this.renderer.notice(`权限预设已是 ${name}`)
      return
    }
    const result = await this.controller.executeHostCommand(`/permission ${name}`, { allowBusy: true })
    if (result?.kind === 'error') throw new Error(result.text ?? `切换权限预设 ${name} 失败`)
    this.renderer.success(`权限预设已切换为 ${name}`)
  }

  /**
   * Agent presets are fixed at session creation; the host only lets a blank
   * session switch in place (agent-preset-locked otherwise).
   */
  async preset(requested) {
    const { presets } = await this.controller.listAgentPresets()
    if (presets.length === 0) throw new Error('宿主没有返回可用的 Agent 预设')
    const current = this.controller.agentPreset
    let id = requested
    if (!id) {
      this.renderer.presetList(presets, current)
      const index = await this.input.choose('切换到哪个 Agent 预设？[0 取消] › ', presets.length, {
        allowZero: true,
        context: 'preset-choice',
      })
      if (index === undefined) return
      id = presets[index].id
    }
    const known = presets.find(preset => preset.id === id)
    if (!known) {
      throw new Error(`未知 Agent 预设 ${id}；可选：${presets.map(preset => preset.id).join('、')}`)
    }
    if (id === current) {
      this.renderer.notice(`Agent 预设已是 ${id}`)
      return
    }
    try {
      await this.controller.selectAgentPreset(id)
    } catch (error) {
      if (error?.code === 'agent-preset-locked') {
        // Presets pin at session creation (same rule as the web UI): offer
        // the natural escape hatch, a fresh session on the chosen preset.
        const label = known.name ? `${known.name} (${id})` : id
        const create = await this.input.confirm(
          `当前会话已开始对话，预设不可更改。用「${label}」创建新会话？`,
          { defaultValue: false, context: 'preset-new' },
        )
        if (!create) return
        await this.controller.newSession(this.controller.cwd, { agentPreset: id })
        return
      }
      throw error
    }
    this.renderer.success(`Agent 预设已切换为 ${id}`)
  }

  /**
   * Run a Harness-native slash command through the commands registry and
   * surface its result text (e.g. "Plan mode on. Use /plan off to leave.").
   */
  async hostCommand(line) {
    const result = await this.controller.executeHostCommand(line)
    if (result?.kind === 'error') throw new Error(result.text ?? `命令执行失败：${line}`)
    if (result?.text) this.renderer.notice(result.text)
  }

  /**
   * Full-text session search: list hits with snippets and offer to resume
   * one through the same picker as /resume.
   */
  async search(words) {
    const query = words.join(' ').trim()
    if (query === '') throw new Error('用法：/search <关键词>')
    const { items, hasMore } = await this.controller.searchSessions(query)
    if (items.length === 0) {
      this.renderer.notice(`没有命中「${query}」的会话`)
      return
    }
    this.renderer.searchList(items, hasMore)
    const index = await this.input.choose('恢复哪一个？[0 取消] › ', items.length, {
      allowZero: true,
      context: 'search-choice',
    })
    if (index === undefined) return
    await this.controller.switchSession(items[index].sessionId, { showHistory: true })
  }

  /**
   * List or invoke skills. Invocation is plain text (`/name args`) — the
   * host's pre-step expands the skill body, same as the web composer's pick.
   */
  async skill(words) {
    const skills = this.controller.skills.length > 0
      ? this.controller.skills
      : await this.controller.refreshSkills()
    if (skills.length === 0) throw new Error('当前会话没有可调用的技能')
    let name = words[0]
    if (!name) {
      this.renderer.skillList(skills)
      const index = await this.input.choose('调用哪个技能？[0 取消] › ', skills.length, {
        allowZero: true,
        context: 'skill-choice',
      })
      if (index === undefined) return
      name = skills[index].name
    }
    if (!skills.some(skill => skill.name === name)) {
      throw new Error(`未知技能 ${name}；可用：${skills.map(skill => skill.name).join('、')}`)
    }
    const extra = words.slice(1).join(' ')
    await this.controller.send(`/${name}${extra ? ` ${extra}` : ''}`)
  }

  approval(policy) {
    if (!policy) {
      this.renderer.notice(`当前审批策略：${this.controller.approvalPolicy}`)
      return
    }
    this.controller.setApprovalPolicy(policy.toLowerCase())
  }

  /**
   * Queue dock: bare /queue lists pending inbox items; subcommands mutate one
   * item through session.updateQueue (the next session/queue frame confirms).
   */
  async queue(words) {
    const items = this.controller.queueItems()
    const sub = words[0]?.toLowerCase()
    if (!sub) {
      this.renderer.queueList(items)
      return
    }
    if (!['remove', 'steer', 'edit'].includes(sub)) {
      throw new Error('用法：/queue [remove|steer|edit <编号> [新文本]]')
    }
    if (items.length === 0) throw new Error('队列是空的')
    const index = Number(words[1])
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      throw new Error(`编号必须是 1-${items.length}`)
    }
    const item = items[index - 1]
    if (sub === 'edit') {
      const text = words.slice(2).join(' ').trim()
      if (text === '') throw new Error('用法：/queue edit <编号> <新文本>')
      await this.controller.updateQueueItem(item.id, { kind: 'edit', content: [{ type: 'text', text }] })
      this.renderer.success(`已修改队列消息 #${index}`)
      return
    }
    await this.controller.updateQueueItem(item.id, { kind: sub })
    this.renderer.success(sub === 'remove' ? `已移除队列消息 #${index}` : `队列消息 #${index} 已转为 steering`)
  }

  /** 👍/👎 for the latest assistant reply; an optional note follows the direction. */
  async feedback(words) {
    const rating = { up: 'positive', good: 'positive', down: 'negative', bad: 'negative' }[words[0]?.toLowerCase()]
    if (!rating) throw new Error('用法：/feedback up|down [备注]')
    const note = words.slice(1).join(' ').trim()
    await this.controller.submitFeedback(rating, note || undefined)
  }

  /** Archive by id/prefix, or pick from the session list when omitted. */
  async archive(requested) {
    if (requested) {
      await this.controller.archiveSession(requested)
      return
    }
    const sessions = (await this.controller.listSessions()).filter(item => item.sessionId !== this.controller.sessionId)
    if (sessions.length === 0) {
      this.renderer.notice('没有可归档的会话（当前会话不能归档）')
      return
    }
    this.renderer.sessionList(sessions.slice(0, 50))
    const index = await this.input.choose('归档哪一个？[0 取消] › ', Math.min(sessions.length, 50), {
      allowZero: true,
      context: 'archive-choice',
    })
    if (index === undefined) return
    await this.controller.archiveSession(sessions[index].sessionId)
  }

  toggleRenderer(kind, value) {
    const property = kind === 'verbose' ? 'verbose' : 'debugEnabled'
    let enabled
    if (value === undefined) enabled = !this.renderer[property]
    else if (['on', 'true', '1', 'yes'].includes(value.toLowerCase())) enabled = true
    else if (['off', 'false', '0', 'no'].includes(value.toLowerCase())) enabled = false
    else throw new Error(`用法：/${kind} on|off`)
    if (kind === 'verbose') this.renderer.setVerbose(enabled)
    else this.renderer.setDebug(enabled)
  }
}
