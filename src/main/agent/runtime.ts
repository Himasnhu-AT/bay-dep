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
