import { LOCAL_COMMANDS } from './commands.js'

/**
 * Composer TAB completion for slash commands. The first word completes
 * against local commands plus the host's native registry (commands/list,
 * cached on the controller); the argument of a known command completes
 * against its registry-declared source (LOCAL_COMMANDS[name].completeArg).
 * RPC-backed sources are memoized briefly so repeated TABs stay local.
 */

const MEMO_TTL_MS = 30_000

export function createCompleter({ controller }) {
  const memo = new Map()
  const cached = async (key, load) => {
    const entry = memo.get(key)
    if (entry && Date.now() - entry.at < MEMO_TTL_MS) return entry.value
    const value = await load().catch(() => [])
    memo.set(key, { at: Date.now(), value })
    return value
  }

  const argCandidates = {
    model: () => controller.modelOptions().map(option => `${option.provider}/${option.model}`),
    reasoning: () => controller.reasoningOptions()?.efforts?.map(effort => effort.id) ?? [],
    permission: () => controller.permissionView()?.options?.map(option => option.value) ?? [],
    preset: () => cached('presets', async () => (await controller.listAgentPresets()).presets.map(preset => preset.id)),
    session: () => cached('sessions', async () => (await controller.listSessions()).map(item => item.sessionId)),
    skill: () => (controller.skills ?? []).map(skill => skill.name),
    approval: () => ['ask', 'allow', 'deny'],
    feedback: () => ['up', 'down'],
    queue: () => ['remove', 'steer', 'edit'],
    onoff: () => ['on', 'off'],
  }

  return async line => completeLine(line, controller, argCandidates)
}

async function completeLine(line, controller, argCandidates) {
  if (typeof line !== 'string' || !line.startsWith('/')) return [[], line ?? '']

  const firstSpace = line.search(/\s/)
  if (firstSpace === -1) {
    const matches = commandNames(controller).filter(name => name.startsWith(line))
    // A sole match for a command with a completable argument carries a
    // trailing space, so TAB drops the cursor straight into argument position
    // instead of gluing the next word onto the command name.
    if (matches.length === 1 && LOCAL_COMMANDS[matches[0]]?.completeArg) return [[`${matches[0]} `], line]
    return [matches, line]
  }

  const command = line.slice(0, firstSpace).toLowerCase()
  const source = LOCAL_COMMANDS[command]?.completeArg
  if (!source || !argCandidates[source]) return [[], line]
  // Completion covers the first argument only; free-text arguments (/rename) opt out above.
  const word = line.slice(firstSpace + 1).replace(/^\s+/, '')
  if (/\s/.test(word)) return [[], line]
  const candidates = await argCandidates[source]()
  return [candidates.filter(candidate => candidate.startsWith(word)), word]
}

function commandNames(controller) {
  const names = new Set(Object.keys(LOCAL_COMMANDS))
  for (const descriptor of controller.hostCommands ?? []) {
    if (typeof descriptor?.name === 'string') names.add(`/${descriptor.name}`)
  }
  return [...names].sort()
}

/**
 * Menu entries for the slash popup: local commands with their registry
 * metadata, plus the host's native commands that don't shadow them.
 * @returns [{ name, description, takesArg }]
 */
export function slashEntries(controller) {
  const entries = Object.entries(LOCAL_COMMANDS).map(([name, meta]) => ({
    name,
    description: meta.description ?? '',
    takesArg: Boolean(meta.hint),
  }))
  for (const descriptor of controller.hostCommands ?? []) {
    const name = `/${descriptor?.name}`
    if (typeof descriptor?.name !== 'string' || Object.hasOwn(LOCAL_COMMANDS, name)) continue
    entries.push({
      name,
      description: descriptor.description ?? '',
      takesArg: Boolean(descriptor.input?.hint),
    })
  }
  for (const skill of controller.skills ?? []) {
    const name = `/${skill?.name}`
    if (typeof skill?.name !== 'string' || entries.some(entry => entry.name === name)) continue
    entries.push({
      name,
      description: skill.description ? `${skill.description} · 技能` : '技能',
      takesArg: true,
    })
  }
  return entries.sort((left, right) => (left.name < right.name ? -1 : 1))
}
