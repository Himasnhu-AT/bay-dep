/**
 * What `host.ts` needs from a runtime, and which runtime it gets.
 *
 * Three runtimes host the same conversation: `CliAgentRuntime` (the `claude` binary on the
 * user's machine, spoken to over stream-json), `SdkAgentRuntime` (the Agent SDK in main) and
 * `CodexAgentRuntime` (OpenAI's `codex` binary, one `codex exec --json` per turn). All satisfy
 * this one interface, and the host holds nothing more specific than it — so the panel, which only
 * ever sees `AgentEvent`s, has no way to tell them apart.
 *
 * Not `AgentRuntime` from `@shared/agent`: that contract has `send` return an
 * `AsyncIterable` of the turn's events, which no runtime implements. Events leave main
 * through a broadcast to every window, so a listener is the shape that actually exists; `send`
 * returns the new turn's `runId`, and `started` is always the first event emitted for it.
 *
 * No `electron` import here, so the selection logic runs under `pnpm test`.
 */

import type { AgentEvent, AgentProvider, AgentTuning } from '@shared/agent'
import { resolveStatusMessage, type ProjectHost } from '@shared/host'
import type { McpServerEntry } from '../resolve'

export interface HostedAgentRuntime {
  readonly id: string
  /**
   * The provider's own id for this conversation, once known — what names its transcript file:
   * Claude Code's session under `~/.claude/projects`, or Codex's thread under the runtime's
   * `CODEX_HOME/sessions`. The CLI runtime chooses it up front; the SDK and Codex learn it from
   * the first turn, so it is null until then.
   */
  readonly sessionId: string | null
  /** Subscribe to every event of every turn. Returns the unsubscribe. */
  onEvent(listener: (event: AgentEvent) => void): () => void
  /**
   * Start a turn. Returns its `runId`; `started` is emitted before this returns. `images` are
   * absolute paths to attach to this message; a runtime that cannot attach them ignores them.
   */
  send(text: string, images?: readonly string[]): string
  /** Abandon the current turn. Safe to call when nothing is running. */
  stop(): void
  /**
   * Preferences › Agent changed. Applies from the next turn, never to the one running: a runtime
   * whose flags are fixed at spawn replaces its process at the next `send`.
   */
  configure(tuning: AgentTuning): void
  dispose(): void
}

export type RuntimeKind = 'cli' | 'sdk' | 'codex'

/** The environment variable that picks the runtime. */
export const RUNTIME_ENV = 'BAY_AGENT_RUNTIME'

/**
 * Which runtime a value of `BAY_AGENT_RUNTIME` asks for.
 *
 * Unset or empty means the CLI, which stays the default. Anything else that is not a known
 * name is **refused, not defaulted**: someone who typed `BAY_AGENT_RUNTIME=skd` asked for the
 * SDK, and quietly handing them the CLI would make every observation they then make about
 * "the SDK runtime" an observation about the other one.
 */
export function chooseRuntime(
  value: string | undefined
): { ok: true; kind: RuntimeKind } | { ok: false; error: string } {
  const normalised = (value ?? '').trim().toLowerCase()
  if (normalised === '' || normalised === 'cli') return { ok: true, kind: 'cli' }
  if (normalised === 'sdk') return { ok: true, kind: 'sdk' }
  if (normalised === 'codex') return { ok: true, kind: 'codex' }
  return {
    ok: false,
    error: `${RUNTIME_ENV} is set to "${value}", which is not a runtime bay has. Use "cli" (the default), "sdk" or "codex", or unset it.`
  }
}

/**
 * The runtime for one start: `BAY_AGENT_RUNTIME` when it is set — the developer's override wins
 * over the Settings choice, so a probe run with `=sdk` measures the SDK whatever the profile
 * remembers — and otherwise the provider the user picked, Claude meaning the CLI.
 */
export function runtimeFor(
  envValue: string | undefined,
  provider: AgentProvider | undefined
): { ok: true; kind: RuntimeKind } | { ok: false; error: string } {
  if ((envValue ?? '').trim() !== '') return chooseRuntime(envValue)
  return { ok: true, kind: provider === 'codex' ? 'codex' : 'cli' }
}

/** Which provider a runtime belongs to. */
export function providerOf(kind: RuntimeKind): AgentProvider {
  return kind === 'codex' ? 'codex' : 'claude'
}

/** What a conversation was started as. A start asking for anything else replaces it. */
export interface ConversationKey {
  provider: AgentProvider
  host: ProjectHost
}

/**
 * Whether a start may answer with the conversation already running.
 *
 * Only when it is the same provider **and** the same host. A Resolve project's conversation has
 * the Resolve tools and a prompt that says the timeline is in Resolve; handed to a bay project it
 * would edit Resolve while the user watched bay's timeline stand still, and the other way round
 * it would have no Resolve tools at all.
 */
export function sameConversation(running: ConversationKey, wanted: ConversationKey): boolean {
  return running.provider === wanted.provider && running.host === wanted.host
}

/**
 * Switches the connector's own update check off. Left on, the connector asks GitHub for its
 * releases when it starts — a request bay did not make and the user did not ask for. Updating
 * the connector is `script/setup-resolve-mcp.sh`'s job.
 */
export const RESOLVE_CONNECTOR_ENV: Readonly<Record<string, string>> = { DAVINCI_RESOLVE_MCP_UPDATE_CHECK: '0' }

/**
 * The Resolve connector for one start: none for a bay project, the server for a Resolve project,
 * or the sentence the user reads when a Resolve project cannot start.
 *
 * - **Codex is refused.** The connector has tools that run scripts and install plugins
 *   (`@shared/resolve-tools`); Claude Code withholds them through its allow-list, and Codex has
 *   none. Its config does take `enabled_tools` on an MCP server — measured on codex-cli 0.157.0:
 *   accepted under `--strict-config` where a misspelt sibling key is refused — but whether the
 *   model is then really without the other tools was **not** measured (it takes a signed-in
 *   turn; the tool names are not in the request Codex builds, which a stub provider showed).
 *   A sandbox checked only as config text is how the Codex approval fault shipped, so until a
 *   real turn has shown a withheld tool refused, a Resolve project does not start on Codex.
 * - **No connector is refused**, with the setup command, rather than starting a conversation
 *   whose prompt names tools it does not have.
 *
 * `server` is what `resolveMcpServer()` answered; asked for only when the host is Resolve.
 */
export function resolveForStart(
  host: ProjectHost,
  provider: AgentProvider,
  name: string,
  server: () => McpServerEntry | null
): { ok: true; resolve: { name: string; entry: McpServerEntry } | null } | { ok: false; error: string } {
  if (host !== 'resolve') return { ok: true, resolve: null }
  if (provider === 'codex') {
    return {
      ok: false,
      error:
        'This project is edited in DaVinci Resolve, which needs the Claude agent for now: Codex cannot be limited to the Resolve tools bay allows. Choose Claude in Preferences › Agent › Model, then start again.'
    }
  }
  const entry = server()
  if (!entry) return { ok: false, error: resolveStatusMessage({ state: 'not-set-up' }) }
  return { ok: true, resolve: { name, entry: { ...entry, env: { ...entry.env, ...RESOLVE_CONNECTOR_ENV } } } }
}
