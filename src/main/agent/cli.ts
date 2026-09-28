/**
 * Claude Code, running inside bay, driving bay.
 *
 * The binary on the user's machine rather than an embedded SDK: it is already installed and
 * already signed in, so there is no API key to ask for and no second auth surface to build.
 * The cost is that bay does not own the model loop — which is why `AgentRuntime` exists, so the
 * panel never learns which of the two it is talking to.
 *
 * **Bay's tools and nothing else.** Four flags together:
 *
 * - `--tools` naming the only built-ins it gets — the two MCP resource readers, so it can read
 *   bay's guides, and `Skill`, so it can load a bay skill named anywhere in a message (see
 *   `BUILT_IN_TOOLS`) — which removes every other built-in outright: no shell, no files, no web,
 *   no subagents. Measured: with the two readers alone, a request to run `id` had nothing to run
 *   it with, and the session's tool list was bay's tools plus those two.
 * - `--mcp-config` with only bay, plus `--strict-mcp-config`, so the user's *other* MCP servers
 *   are not inherited. Measured, not assumed: a session started with `--setting-sources ''`
 *   still had a Gmail server's tools in its tool list.
 * - `--allowedTools` naming exactly those tools — `Skill` narrowed to `Skill(<slug>)` for bay's
 *   own skills — and `--permission-prompts none`, so anything else is **denied** rather than left
 *   waiting on a prompt nobody can answer. The panel deliberately renders no permission dialogs:
 *   by default the agent edits directly and each turn's Changes card, with its Revert, is the
 *   review; with "Ask before editing" on, the `propose_edit` gate is where permission lives.
 * - `--setting-sources project`, from the agent's own working directory, which holds nothing but
 *   bay's skills (see `host.ts`). The user's own settings, CLAUDE.md files and skills stay out.
 *
 * This replaced `--restricted` plus a deny-list of built-ins by name. `--restricted` also
 * disables project skills — measured: with it the skill was absent from the session and
 * `/motion-graphics` was "not installed" — and a deny-list goes stale as the CLI adds tools:
 * this one still named `Task` after the subagent tool had become `Agent`, and it did not name
 * `Monitor` (which runs commands), `RemoteTrigger` or `Workflow`. An allow-list of built-ins
 * cannot miss a tool the CLI adds later.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { setPriority } from 'node:os'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { BAY_SKILLS } from '@shared/skills'
import { newStreamState, parseLine, toAgentEvents } from './stream'
import type { HostedAgentRuntime } from './runtime'

/**
 * How far below the editor the agent runs. The model's own work happens elsewhere, but the CLI,
 * its MCP proxy and anything they spawn share this machine with the preview — and a preview that
 * stutters because an agent is thinking is the editor failing at its one real-time job. Ten is
 * "background" on every Unix scheduler without being starved.
 */
export const AGENT_NICENESS = 10

/** `pid → [ppid, pgid]` for every process on the machine, from one `ps`. Empty if `ps` fails. */
export type ProcessTable = Map<number, { ppid: number; pgid: number }>

export function processTable(): ProcessTable {
  const table: ProcessTable = new Map()
  const ps = existsSync('/bin/ps') ? '/bin/ps' : 'ps'
  const out = spawnSync(ps, ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 5000 })
  if (out.status !== 0 || typeof out.stdout !== 'string') return table
  for (const line of out.stdout.split('\n')) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
    if (pid !== undefined && ppid !== undefined && pgid !== undefined && Number.isInteger(pid) && pid > 0) {
      table.set(pid, { ppid, pgid })
    }
  }
  return table
}

/** Every process below `pid` — children, their children, and so on. */
export function descendantsOf(pid: number, table: ProcessTable): number[] {
  const children = new Map<number, number[]>()
  for (const [child, { ppid }] of table) {
    const list = children.get(ppid)
    if (list) list.push(child)
    else children.set(ppid, [child])
  }
  const found: number[] = []
  const queue = [pid]
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (found.includes(child) || child === pid) continue
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/**
 * Kill a child and everything it started.
 *
 * The CLI is not one process: it spawns bay's MCP proxy, and may spawn more. Killing only the
 * pid we hold leaves those re-parented to launchd, still holding a socket connection into the
 * app — a proxy per stopped turn, accumulating. Spawning `detached` makes the child a process
 * group leader, so the negative pid reaches the whole group.
 *
 * **The group is not enough on its own.** Codex 0.149.1 starts each MCP server in a process
 * group of its own — measured: bay's proxy survived `kill(-pgid)` of the codex it was started
 * by. So the tree is read from `ps` *before* anything is signalled (after, the orphans belong to
 * launchd and nothing links them to us) and every descendant outside the group gets the signal
 * by pid. Windows has neither groups nor this `ps`; there the plain kill is the best available.
 */
export function killTree(
  pid: number | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
  table: () => ProcessTable = processTable
): void {
  if (pid === undefined) return
  const send = (target: number): void => {
    try {
      kill(target, signal)
    } catch {
      // Already gone — it died between the check and the signal, which is the goal.
    }
  }
  if (process.platform === 'win32') {
    send(pid)
    return
  }
  const processes = table()
  const outside = descendantsOf(pid, processes).filter((child) => processes.get(child)?.pgid !== pid)
  send(-pid)
  for (const child of outside) send(child)
}

/**
 * The environment for Claude Code's process, for both runtimes.
 *
 * `process.env` minus `ELECTRON_RUN_AS_NODE` — set, it would leak into anything Claude Code
 * spawns that happens to be Electron — deleted rather than set to `undefined`, because the SDK's
 * `env` replaces the child's environment and must not depend on how it copies one.
 *
 * Plus `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. `--setting-sources project` loads the workspace's
 * skills, but Claude Code also reads every CLAUDE.md in the folders *above* the working
 * directory — measured: a marker in the workspace's parent reached the model, and a user's
 * `~/CLAUDE.md` written for their own repositories would have steered bay's video edits. With
 * this set the marker did not arrive and a project skill still loaded.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env['CLAUDE_CODE_DISABLE_CLAUDE_MDS'] = '1'
  // Claude Code's own ceiling on one MCP tool call — "a hard wall-clock limit per call; progress
  // notifications do not extend it" (the CLI's own help text for the per-server `timeout`, which
  // overrides this variable). Set, not left to the CLI's default, because `export_timeline` and the
  // track tools wait up to 30 minutes by design, and a client that gave up first would report a
  // failure for an export that was still rendering.
  env['MCP_TOOL_TIMEOUT'] = String(MCP_TOOL_TIMEOUT_MS)
  // And its *idle* ceiling: a stdio call with "no response or progress" for this long is aborted.
  // Read out of the bundled CLI (claude-agent-sdk 0.3.280): the stdio default is 1,800,000 ms —
  // exactly the 30-minute wait, so a wait that ran to its ceiling would lose the race to it.
  env['CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT'] = String(MCP_TOOL_TIMEOUT_MS)
  return env
}

/**
 * The agent's timeout for one bay tool call: the slowest tool's own budget (`timeoutMs`, which is
 * what main waits in `server.ts`) plus a minute, so main's answer — its own timeout message
 * included — always arrives before the client stops listening.
 */
export const MCP_TOOL_TIMEOUT_MS = Math.max(60_000, ...TOOLS.map((tool) => tool.timeoutMs ?? 0)) + 60_000

/**
 * How long a turn may run before it is abandoned. A stuck turn must not be a stuck panel.
 *
 * Derived from the catalog rather than written down: it has to outlast the slowest single tool
 * call plus the model's own work around it. It was a literal 10 minutes while `transcribe` was
 * allowed 15 (a first run downloads a model), so on a slow link the panel killed a turn whose
 * tool was still inside its own budget, and the transcription ran on with nobody waiting.
 */
export const TURN_TIMEOUT_MS = Math.max(
  10 * 60 * 1000,
  ...TOOLS.map((tool) => (tool.timeoutMs ?? 0) + 5 * 60 * 1000)
)

export interface CliOptions {
  /** The `claude` binary. Found on PATH when not given. */
  binary?: string
  /** Absolute path to bay's MCP proxy bundle — `out/main/mcp/index.js`. */
  proxyPath: string
  /** The running app's socket, so the proxy talks to *this* bay rather than launching another. */
  socketPath: string
  /** Where the agent's own files live. Never the project directory. */
  cwd: string
  systemPrompt: string
  /** How long a turn may run. `TURN_TIMEOUT_MS` unless a test needs to see one run out. */
  turnTimeoutMs?: number
}

/** Bay's tools, namespaced the way the CLI reports them. */
export function allowedToolNames(): string[] {
  return [
    ...TOOLS.map((tool) => `mcp__bay__${tool.name}`),
    'ListMcpResourcesTool',
    'ReadMcpResourceTool',
    // Scoped to bay's skills by name. Measured as a partial gate, not a wall: it denied a bundled
    // skill that asks for approval, and one that does not still loaded — harmless here, since a
    // skill is only instructions and there is nothing to act on them with.
    ...BAY_SKILLS.map((skill) => `Skill(${skill.slug})`)
  ]
}

/**
 * The only built-in tools the in-app agent has: reading bay's MCP resources (its guides), and
 * `Skill`, so it can load a bay skill the user names, or one the task calls for. Everything else built
 * in — shell, files, web, subagents — does not exist in the session at all. MCP tools are not
 * built-ins, so bay's own are unaffected.
 *
 * `Skill` is here because the CLI expands only one `/skill`, at the very start of a message.
 * "Edit this with /motion-graphics and /captions" needs the model to load both itself — measured:
 * with the tool, it called Skill for each and followed both. It can also reach Claude Code's
 * bundled skills; those have nothing to act with here (no shell, no files), the allow-list below
 * scopes the permission to bay's skill names, and the system prompt says to use only bay's.
 */
export const BUILT_IN_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'Skill'] as const

/**
 * Bay's MCP proxy as a stdio server entry.
 *
 * Shared with the SDK runtime (`sdk.ts`) rather than written twice, so the two runtimes launch
 * the same proxy with the same environment by construction instead of by agreement.
 */
export function bayMcpServer(options: Pick<CliOptions, 'proxyPath' | 'socketPath'>): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  return {
    command: process.execPath,
    args: [options.proxyPath],
    env: {
      // `ELECTRON_RUN_AS_NODE` because `process.execPath` is Electron here: the proxy must
      // run as plain Node or Chromium writes to the stdout the protocol needs byte-exact.
      ELECTRON_RUN_AS_NODE: '1',
      BAY_MCP_SOCKET: options.socketPath,
      // Pinned, not inherited. The panel allows the agent bay's tools by name
      // (`allowedToolNames`); a `BAY_MCP_MODE=gateway` left in the shell that launched bay would
      // otherwise reach this proxy and publish three tools, none of them on that list.
      BAY_MCP_MODE: 'full'
    }
  }
}

export function mcpConfig(options: CliOptions): string {
  return JSON.stringify({ mcpServers: { bay: bayMcpServer(options) } })
}

/**
 * `resume` is whether this session already exists on disk. The first process creates it with
 * `--session-id`; any later one — after a stop, or a crash — must `--resume` it instead, because
 * the CLI refuses to *create* a session under an id it already has.
 */
export function cliArgs(options: CliOptions, sessionId: string, resume = false): string[] {
  return [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', mcpConfig(options),
    '--strict-mcp-config',
    // The built-ins that exist at all. Everything not named is absent, not merely denied.
    '--tools', BUILT_IN_TOOLS.join(','),
    '--allowedTools', ...allowedToolNames(),
    // Anything not allowed above is refused rather than queued behind a prompt no one can see.
    '--permission-prompts', 'none',
    // Project settings from the agent's own directory, which holds only bay's skills. The
    // user's own instructions are theirs, not bay's: a CLAUDE.md written for some other
    // repository would put that repository's rules into a video edit.
    '--setting-sources', 'project',
    '--system-prompt', options.systemPrompt,
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId])
  ]
}

/** What an attached image file is, by the extension bay gave it (`agent/attachments.ts`). */
export function imageMediaType(path: string): 'image/png' | 'image/jpeg' {
  return /\.png$/i.test(path) ? 'image/png' : 'image/jpeg'
}

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }

/**
 * One user turn as Messages API content blocks: each attached image inline as base64, then the
 * text. Images first, the order the model reads best. Shared by both Claude runtimes; `read` is
 * injected in tests.
 *
 * Measured with claude 2.1.281 over `--input-format stream-json`: a 64×64 solid #1E90FF PNG sent
 * this way with "What colour is this image? Answer with one word." answered "Blue", and a solid
 * #22AA22 one "Green." — the picture reached the model, rather than a guess.
 */
export function userContent(
  text: string,
  images: readonly string[] = [],
  read: (path: string) => Buffer = (path) => readFileSync(path)
): UserContentBlock[] {
  return [
    ...images.map((path) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: imageMediaType(path), data: read(path).toString('base64') }
    })),
    { type: 'text' as const, text }
  ]
}

/**
 * One conversation, backed by one long-lived `claude` process.
 *
 * The process outlives a turn on purpose: `--input-format stream-json` keeps it listening, so
 * the second message costs no startup and the model keeps its context. Killing between turns
 * would make every reply a cold start with no memory of the last one.
 */
export class CliAgentRuntime implements HostedAgentRuntime {
  readonly id = randomUUID()
  #child: ChildProcessWithoutNullStreams | null = null
  #buffer = ''
  #listeners = new Set<(event: AgentEvent) => void>()
  #runId: string | null = null
  /** Which content block is which tool call, for the run in progress. */
  #stream = newStreamState()
  #timer: NodeJS.Timeout | null = null
  /** The CLI is started with `--session-id` set to the runtime id, so they are the same. */
  get sessionId(): string {
    return this.id
  }

  /** Whether a process has ever been started for this session, so the next one resumes it. */
  #spawned = false

  readonly #options: CliOptions

  constructor(options: CliOptions) {
    this.#options = options
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event)
  }

  #ensure(): ChildProcessWithoutNullStreams {
    if (this.#child && !this.#child.killed) return this.#child
    const args = cliArgs(this.#options, this.id, this.#spawned)
    const child = spawn(this.#options.binary ?? 'claude', args, {
      cwd: this.#options.cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so `killTree` reaches the proxy it spawns.
      detached: process.platform !== 'win32'
    })
    this.#spawned = true
    if (child.pid !== undefined) {
      try {
        // Inherited by everything the CLI spawns, which is the point: the proxy too.
        setPriority(child.pid, AGENT_NICENESS)
      } catch {
        // Not permitted here, or already exited. Normal priority is a degradation, not a failure.
      }
    }

    child.stdout.setEncoding('utf8')
    // A killed process's last lines are not the next turn's.
    child.stdout.on('data', (chunk: string) => {
      if (this.#child === child) this.#consume(chunk)
    })

    // stderr is diagnostics, never protocol. Kept for the failure message rather than parsed.
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000)
    })

    child.on('error', (error) => {
      if (this.#child === child) this.#fail(`claude could not be started: ${error.message}`)
    })
    child.on('exit', (code) => {
      // Only the current process speaks for the turn. A stopped one exits *after* the next send
      // has spawned its successor; clearing `#child` then left the new process untracked (the
      // next send spawned a third beside it, and no stop could reach the second) and failed the
      // new turn with the old one's exit.
      if (this.#child !== child) return
      this.#child = null
      if (this.#runId) {
        // Exiting mid-turn is a failure whatever the code says: the panel is waiting for an
        // answer that is never coming, and silence is the one outcome it cannot render.
        this.#fail(
          code === 0
            ? 'claude exited before finishing the turn.'
            : `claude exited with code ${code}. ${stderr.trim().slice(-500)}`
        )
      }
    })

    this.#child = child
    return child
  }

  #consume(chunk: string): void {
    this.#buffer += chunk
    let index: number
    while ((index = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, index)
      this.#buffer = this.#buffer.slice(index + 1)
      const message = parseLine(line)
      if (!message || !this.#runId) continue
      for (const event of toAgentEvents(message, this.#runId, this.#stream)) {
        if (event.type === 'done') this.#settle()
        this.#emit(event)
      }
    }
  }

  #settle(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#runId = null
  }

  #fail(message: string): void {
    const runId = this.#runId
    this.#settle()
    if (runId) this.#emit({ type: 'done', runId, reason: 'error', message })
  }

  /**
   * Send one message. Events arrive through `onEvent`; `started` is emitted first. `images` are
   * files bay wrote into its own attachments folder, sent inline.
   */
  send(text: string, images: readonly string[] = []): string {
    const runId = randomUUID()
    this.#runId = runId
    this.#stream = newStreamState()
    this.#emit({ type: 'started', runId })

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.#ensure()
    } catch (error) {
      this.#fail(`claude could not be started: ${(error as Error).message}`)
      return runId
    }

    // Stopped means killed. Failing the turn alone told the panel it had stopped while the
    // process carried on calling tools against the timeline, its later output landing on
    // whatever turn came next.
    const timeout = this.#options.turnTimeoutMs ?? TURN_TIMEOUT_MS
    this.#timer = setTimeout(
      () => this.#abort(`The turn ran past ${Math.round(timeout / 60000)} minutes and was stopped.`),
      timeout
    )

    let content: UserContentBlock[]
    try {
      content = userContent(text, images)
    } catch (error) {
      this.#fail(`An attachment could not be read: ${(error as Error).message}`)
      return runId
    }
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`)
    return runId
  }

  /**
   * Abandon the current turn.
   *
   * The process is killed rather than asked to stop: there is no in-band cancel in the stream
   * protocol, and a turn that keeps running after the user said stop would keep calling tools
   * against their timeline. The next `send` starts a fresh process that resumes the same
   * session, so the conversation's context survives the stop.
   */
  stop(): void {
    this.#abort('Stopped.')
  }

  #abort(message: string): void {
    this.#fail(message)
    killTree(this.#child?.pid)
    this.#child = null
    this.#buffer = ''
  }

  dispose(): void {
    this.#settle()
    this.#listeners.clear()
    killTree(this.#child?.pid)
    this.#child = null
  }
}
