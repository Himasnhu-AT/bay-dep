/**
 * Claude Code, running inside bay, driving bay — hosted by the Agent SDK instead of a
 * long-lived `claude --print` process.
 *
 * Selected with `BAY_AGENT_RUNTIME=sdk`; the CLI runtime (`cli.ts`) stays the default. The two
 * are meant to be indistinguishable from the panel, so the sandbox here is **the CLI's sandbox,
 * imported, not restated**: the same proxy entry (`bayMcpServer`), the same allow-list
 * (`allowedToolNames`), the same built-in allow-list (`BUILT_IN_TOOLS`). A restriction added to one
 * reaches the other without anyone remembering to copy it. Mapped onto the SDK's options:
 *
 * | CLI flag                         | SDK option                         |
 * | -------------------------------- | ---------------------------------- |
 * | `--mcp-config` (bay only)        | `mcpServers: { bay }`              |
 * | `--strict-mcp-config`            | `strictMcpConfig: true`            |
 * | `--allowedTools …`               | `allowedTools`                     |
 * | `--tools <readers>,Skill`        | `tools: [...BUILT_IN_TOOLS]`       |
 * | `--permission-prompts none`      | `permissionPrompts: 'none'`        |
 * | `--setting-sources project`      | `settingSources: ['project']`      |
 * | `--system-prompt`                | `systemPrompt` (a plain string)    |
 * | `--include-partial-messages`     | `includePartialMessages: true`     |
 *
 * `canUseTool` is deliberately **not** set: providing it makes
 * the SDK add `--permission-prompt-tool stdio`, which would route every denied call to this
 * process as a prompt — the thing `permissionPrompts: 'none'` exists to prevent.
 *
 * **Multi-turn is one `query()` per turn, resumed by session id.** The first turn starts a
 * session; every message the SDK yields carries its `session_id`, and the next turn passes the
 * latest one as `resume`. Unlike the CLI runtime, a stopped turn does not cost the conversation:
 * stop aborts that turn's process, and the next `send` resumes the same session. The price is a
 * cold start per turn (a process and an MCP proxy each time) — the CLI runtime keeps one
 * process warm.
 *
 * **Which executable.** The SDK ships Claude Code as a per-platform native binary in an
 * optional dependency (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), pinned to the
 * version the SDK was built against — preferred, because the SDK and the binary speak a control
 * protocol that moves with both. It is resolved here rather than left to the SDK because in a
 * packaged app the SDK's own resolution returns a path inside `app.asar`, which `existsSync`
 * happily confirms (Electron patches `fs`) and the OS cannot execute. When no bundled binary
 * exists — a build for an architecture whose optional dependency was not installed — the host
 * falls back to the user's own `claude` via `findClaude()`.
 *
 * Nothing here imports `electron`, so all of it runs under `pnpm test`; the SDK itself is
 * loaded lazily on the first turn, so choosing the CLI runtime never loads it at all.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/agent'
import {
  allowedToolNames,
  bayMcpServer,
  BUILT_IN_TOOLS,
  TURN_TIMEOUT_MS,
  type CliOptions
} from './cli'
import type { HostedAgentRuntime } from './runtime'
import { toAgentEvents } from './stream'

/** The SDK's `query`, narrowed to the part bay uses. Injected in tests. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>

export interface SdkOptions extends Omit<CliOptions, 'binary'> {
  /**
   * The Claude Code executable. Omitted, the SDK resolves its own bundled binary — correct in
   * development, wrong inside `app.asar` (see the module comment), so the host always passes
   * one.
   */
  executable?: string
  /** Replaces the SDK's `query`. Tests only. */
  query?: QueryFn
  /** Turn timeout. Tests only; defaults to the CLI runtime's. */
  turnTimeoutMs?: number
}

/**
 * The environment for Claude Code's process.
 *
 * The SDK's `env` *replaces* the child's environment rather than merging, so this starts from
 * `process.env` exactly as the CLI runtime's spawn does, minus `ELECTRON_RUN_AS_NODE`: set,
 * it would leak into anything Claude Code spawns that happens to be Electron. Deleted rather
 * than set to `undefined`, so the result does not depend on how the SDK copies it.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return env
}

/** The options one turn runs with. Pure, so the sandbox is pinned by tests. */
export function sdkOptions(
  options: SdkOptions,
  turn: { resume: string | null; abortController: AbortController }
): Options {
  return {
    cwd: options.cwd,
    systemPrompt: options.systemPrompt,
    mcpServers: { bay: { type: 'stdio', ...bayMcpServer(options) } },
    strictMcpConfig: true,
    allowedTools: allowedToolNames(),
    tools: [...BUILT_IN_TOOLS],
    permissionPrompts: 'none',
    // The agent's own working directory, which holds only bay's skills — see cli.ts.
    settingSources: ['project'],
    includePartialMessages: true,
    env: childEnv(),
    abortController: turn.abortController,
    ...(turn.resume ? { resume: turn.resume } : {}),
    ...(options.executable ? { pathToClaudeCodeExecutable: options.executable } : {})
  }
}

/** The session a message belongs to, when it says. Every SDK message type carries one. */
export function sessionIdOf(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null
  const id = (message as Record<string, unknown>)['session_id']
  return typeof id === 'string' && id.length > 0 ? id : null
}

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

export interface BundledOptions {
  /** `require.resolve`, from somewhere the SDK package is reachable. */
  resolve?: (specifier: string) => string
  /** Resolve relative to the SDK's own location — pnpm does not hoist its platform package. */
  resolveFrom?: (base: string, specifier: string) => string
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
  arch?: string
}

/**
 * `app.asar/…` → `app.asar.unpacked/…`, the only form of the path the OS can execute.
 *
 * Unchanged outside a packaged app. The binary is listed under `asarUnpack` in
 * `electron-builder.yml`; without that, the unpacked path would not exist and the lookup
 * below would report no bundled binary rather than a path that cannot launch.
 */
export function unpackedPath(path: string): string {
  return path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

/**
 * The Claude Code binary the SDK ships for this platform, or null.
 *
 * Same candidate list as the SDK's own resolver (`<pkg>-<platform>-<arch>/claude[.exe]`, both
 * libc variants on Linux), resolved relative to the SDK package, then moved out of the asar.
 */
export function bundledExecutable(opts: BundledOptions = {}): string | null {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const exists = opts.exists ?? existsSync
  const resolve = opts.resolve ?? createRequire(import.meta.url).resolve
  const resolveFrom =
    opts.resolveFrom ?? ((base: string, specifier: string) => createRequire(base).resolve(specifier))

  let sdkEntry: string
  try {
    sdkEntry = resolve(SDK_PACKAGE)
  } catch {
    return null
  }

  const exe = platform === 'win32' ? '.exe' : ''
  const packages =
    platform === 'linux'
      ? [`${SDK_PACKAGE}-linux-${arch}`, `${SDK_PACKAGE}-linux-${arch}-musl`]
      : [`${SDK_PACKAGE}-${platform}-${arch}`]

  for (const pkg of packages) {
    try {
      const path = unpackedPath(resolveFrom(sdkEntry, `${pkg}/claude${exe}`))
      if (exists(path)) return path
    } catch {
      // Not installed for this platform; try the next candidate.
    }
  }
  return null
}

/**
 * One conversation, one SDK session, one `query()` per turn.
 *
 * Every turn is guarded by its `runId`: once a turn is settled — finished, stopped, timed out,
 * superseded — nothing its query yields afterwards reaches a listener. Aborting a query makes
 * its iterator throw, and without the guard that throw would arrive as a second `done` for a
 * turn the panel already closed.
 */
export class SdkAgentRuntime implements HostedAgentRuntime {
  readonly id = randomUUID()
  #listeners = new Set<(event: AgentEvent) => void>()
  #runId: string | null = null
  #abort: AbortController | null = null
  #timer: NodeJS.Timeout | null = null
  /** The session to resume. Null until a turn has told us its id. */
  #sessionId: string | null = null

  get sessionId(): string | null {
    return this.#sessionId
  }

  readonly #options: SdkOptions

  constructor(options: SdkOptions) {
    this.#options = options
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event)
  }

  #settle(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#runId = null
    this.#abort = null
  }

  /** End `runId` with an error — only if it is still the current turn. */
  #fail(runId: string | null, message: string): void {
    if (!runId || runId !== this.#runId) return
    this.#settle()
    this.#emit({ type: 'done', runId, reason: 'error', message })
  }

  /** Send one message. Events arrive through `onEvent`; `started` is emitted first. */
  send(text: string): string {
    // A turn still running is abandoned rather than raced: two queries resuming one session at
    // once would each append to the same transcript.
    if (this.#runId) this.#interrupt('Interrupted by a new message.')

    const runId = randomUUID()
    const abort = new AbortController()
    this.#runId = runId
    this.#abort = abort
    this.#emit({ type: 'started', runId })

    const timeout = this.#options.turnTimeoutMs ?? TURN_TIMEOUT_MS
    this.#timer = setTimeout(() => {
      this.#fail(runId, `The turn ran past ${Math.round(timeout / 60000)} minutes and was stopped.`)
      abort.abort()
    }, timeout)

    void this.#run(runId, text, abort)
    return runId
  }

  async #run(runId: string, text: string, abort: AbortController): Promise<void> {
    try {
      const query = this.#options.query ?? (await import('@anthropic-ai/claude-agent-sdk')).query
      if (runId !== this.#runId) return
      const stream = query({
        prompt: text,
        options: sdkOptions(this.#options, { resume: this.#sessionId, abortController: abort })
      })
      for await (const message of stream) {
        // A settled turn drains silently. Not `break`: after a successful result the SDK may
        // still be writing the transcript the next turn resumes from.
        if (runId !== this.#runId) continue
        const session = sessionIdOf(message)
        if (session) this.#sessionId = session
        for (const event of toAgentEvents(message as unknown as Record<string, unknown>, runId)) {
          if (event.type === 'done') this.#settle()
          this.#emit(event)
        }
      }
      // The stream ended without a result. Silence is the one outcome the panel cannot render.
      this.#fail(runId, 'claude ended the turn without finishing it.')
    } catch (error) {
      this.#fail(runId, `claude could not run the turn: ${(error as Error).message}`)
    }
  }

  #interrupt(message: string): void {
    const abort = this.#abort
    this.#fail(this.#runId, message)
    abort?.abort()
  }

  /**
   * Abandon the current turn.
   *
   * Aborts that turn's process, so it stops calling tools against the timeline. Emits exactly
   * what the CLI runtime emits for a stop — `done`, `error`, "Stopped." — so the panel cannot
   * tell which runtime it is talking to. The session survives: the next `send` resumes it.
   */
  stop(): void {
    this.#interrupt('Stopped.')
  }

  dispose(): void {
    const abort = this.#abort
    this.#settle()
    this.#listeners.clear()
    this.#sessionId = null
    abort?.abort()
  }
}
