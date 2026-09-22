/**
 * Claude Code, running inside bay, driving bay.
 *
 * The binary on the user's machine rather than an embedded SDK: it is already installed and
 * already signed in, so there is no API key to ask for and no second auth surface to build.
 * The cost is that bay does not own the model loop — which is why `AgentRuntime` exists, so the
 * panel never learns which of the two it is talking to.
 *
 * **Bay's tools and nothing else.** Three flags together, and all three are needed:
 *
 * - `--mcp-config` with only bay, plus `--strict-mcp-config`, so the user's *other* MCP servers
 *   are not inherited. Measured, not assumed: a session started with `--setting-sources ''`
 *   still had a Gmail server's tools in its tool list.
 * - `--allowedTools` naming bay's tools explicitly.
 * - `--permission-prompts none`, so anything not on that list is **denied** rather than
 *   prompted. Without it the run would stall on a prompt nobody can answer — there is no
 *   terminal here, and the panel deliberately does not render permission dialogs, because the
 *   approval gate is the place where permission is decided.
 *
 * That leaves Read, Write, Edit, Bash and the rest denied. An agent editing video does not need
 * the user's home directory, and starting narrow is reversible in a way that starting wide is
 * not.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { parseLine, toAgentEvents } from './stream'

/** How long a turn may run before it is abandoned. A stuck turn must not be a stuck panel. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000

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
}

/** Bay's tools, namespaced the way the CLI reports them. */
export function allowedToolNames(): string[] {
  return TOOLS.map((tool) => `mcp__bay__${tool.name}`)
}

/**
 * The built-ins, denied by name.
 *
 * `--allowedTools` turned out not to be enough, and the gap was only visible by asking an agent
 * to try: **`Bash` with `id` ran and returned the user's uid and groups**, while `Read`, `Write`
 * and `WebFetch` were denied. An allow-list governs what needs approval, not what exists, and a
 * command judged safe enough not to need approval runs regardless of what the list says.
 *
 * `Read` and `Write` were denied for a reason that does not hold in general, either — "path is
 * outside allowed working directories". The agent's working directory *is* a directory, so a
 * path inside it would have been permitted. Bay's tools are the whole surface, so the file
 * tools are named here rather than left to a boundary that happens to sit in the right place.
 */
export const DENIED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  // The agent-harness tools. None of them touches the user's files, but none of them is
  // editing video either, and `SendMessage` reaches other Claude sessions on this machine.
  // Named by observation: the agent listed exactly these when asked what it had left.
  'Skill',
  'SlashCommand',
  'ToolSearch',
  'ScheduleWakeup',
  'SendMessage',
  'ListAgents',
  'TaskOutput',
  'TaskStop',
  'CronCreate',
  'CronList',
  'CronDelete',
  'PushNotification',
  'EnterWorktree',
  'ExitWorktree'
]

export function mcpConfig(options: CliOptions): string {
  return JSON.stringify({
    mcpServers: {
      bay: {
        command: process.execPath,
        args: [options.proxyPath],
        env: {
          // `ELECTRON_RUN_AS_NODE` because `process.execPath` is Electron here: the proxy must
          // run as plain Node or Chromium writes to the stdout the protocol needs byte-exact.
          ELECTRON_RUN_AS_NODE: '1',
          BAY_MCP_SOCKET: options.socketPath
        }
      }
    }
  })
}

export function cliArgs(options: CliOptions, sessionId: string): string[] {
  return [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config', mcpConfig(options),
    '--strict-mcp-config',
    '--allowedTools', ...allowedToolNames(),
    // Two mechanisms because they do different things: `--restricted` removes the tools that
    // run commands or code outright, and `--disallowedTools` denies the rest by name. Neither
    // alone was sufficient — see `DENIED_TOOLS`.
    '--restricted',
    '--disallowedTools', ...DENIED_TOOLS,
    // Anything not allowed above is refused rather than queued behind a prompt no one can see.
    '--permission-prompts', 'none',
    // The user's own instructions are theirs, not bay's. Inheriting a CLAUDE.md written for
    // some other repository would put rules about that repository into a video edit.
    '--setting-sources', '',
    '--system-prompt', options.systemPrompt,
    '--session-id', sessionId
  ]
}

/**
 * One conversation, backed by one long-lived `claude` process.
 *
 * The process outlives a turn on purpose: `--input-format stream-json` keeps it listening, so
 * the second message costs no startup and the model keeps its context. Killing between turns
 * would make every reply a cold start with no memory of the last one.
 */
export class CliAgentRuntime {
  readonly id = randomUUID()
  #child: ChildProcessWithoutNullStreams | null = null
  #buffer = ''
  #listeners = new Set<(event: AgentEvent) => void>()
  #runId: string | null = null
  #timer: NodeJS.Timeout | null = null

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
    const child = spawn(this.#options.binary ?? 'claude', cliArgs(this.#options, this.id), {
      cwd: this.#options.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#consume(chunk))

    // stderr is diagnostics, never protocol. Kept for the failure message rather than parsed.
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000)
    })

    child.on('error', (error) => this.#fail(`claude could not be started: ${error.message}`))
    child.on('exit', (code) => {
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
      for (const event of toAgentEvents(message, this.#runId)) {
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

  /** Send one message. Events arrive through `onEvent`; `started` is emitted first. */
  send(text: string): string {
    const runId = randomUUID()
    this.#runId = runId
    this.#emit({ type: 'started', runId })

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.#ensure()
    } catch (error) {
      this.#fail(`claude could not be started: ${(error as Error).message}`)
      return runId
    }

    this.#timer = setTimeout(
      () => this.#fail(`The turn ran past ${Math.round(TURN_TIMEOUT_MS / 60000)} minutes and was stopped.`),
      TURN_TIMEOUT_MS
    )

    child.stdin.write(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] }
      })}\n`
    )
    return runId
  }

  /**
   * Abandon the current turn.
   *
   * The process is killed rather than asked to stop: there is no in-band cancel in the stream
   * protocol, and a turn that keeps running after the user said stop would keep calling tools
   * against their timeline. The next `send` starts a fresh process — the cost is the lost
   * conversation context, which is the right trade against edits nobody asked for.
   */
  stop(): void {
    this.#fail('Stopped.')
    this.#child?.kill('SIGTERM')
    this.#child = null
    this.#buffer = ''
  }

  dispose(): void {
    this.#settle()
    this.#listeners.clear()
    this.#child?.kill('SIGTERM')
    this.#child = null
  }
}
