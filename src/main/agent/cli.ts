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
 *   bay's guides — which removes every other built-in outright: no shell, no files, no web, no
 *   subagents, no `Skill` tool. Measured: with this, a request to run `id` had nothing to run it
 *   with, and the session's tool list was bay's tools plus those two.
 * - `--mcp-config` with only bay, plus `--strict-mcp-config`, so the user's *other* MCP servers
 *   are not inherited. Measured, not assumed: a session started with `--setting-sources ''`
 *   still had a Gmail server's tools in its tool list.
 * - `--allowedTools` naming exactly those tools, and `--permission-prompts none`, so anything
 *   else is **denied** rather than left waiting on a prompt nobody can answer — the panel
 *   deliberately renders no permission dialogs; the approval gate is where permission lives.
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

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setPriority } from 'node:os'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { parseLine, toAgentEvents } from './stream'
import type { HostedAgentRuntime } from './runtime'

/**
 * How far below the editor the agent runs. The model's own work happens elsewhere, but the CLI,
 * its MCP proxy and anything they spawn share this machine with the preview — and a preview that
 * stutters because an agent is thinking is the editor failing at its one real-time job. Ten is
 * "background" on every Unix scheduler without being starved.
 */
export const AGENT_NICENESS = 10

/**
 * Kill a child and everything it started.
 *
 * The CLI is not one process: it spawns bay's MCP proxy, and may spawn more. Killing only the
 * pid we hold leaves those re-parented to launchd, still holding a socket connection into the
 * app — a proxy per stopped turn, accumulating. Spawning `detached` makes the child a process
 * group leader, so the negative pid reaches the whole group. Windows has no groups; there the
 * plain kill is the best available.
 */
export function killTree(
  pid: number | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill
): void {
  if (pid === undefined) return
  try {
    kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch {
    // Already gone — the group died between the check and the signal, which is the goal.
  }
}

/** How long a turn may run before it is abandoned. A stuck turn must not be a stuck panel. */
export const TURN_TIMEOUT_MS = 10 * 60 * 1000

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
  return [...TOOLS.map((tool) => `mcp__bay__${tool.name}`), ...BUILT_IN_TOOLS]
}

/**
 * The only built-in tools the in-app agent has: reading bay's MCP resources (its guides).
 * Everything else built in — shell, files, web, subagents, skills-as-a-tool — does not exist in
 * the session at all. MCP tools are not built-ins, so bay's own are unaffected.
 */
export const BUILT_IN_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool'] as const

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
  #timer: NodeJS.Timeout | null = null
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
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv,
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
   * against their timeline. The next `send` starts a fresh process that resumes the same
   * session, so the conversation's context survives the stop.
   */
  stop(): void {
    this.#fail('Stopped.')
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
