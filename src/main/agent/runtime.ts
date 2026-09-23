/**
 * What `host.ts` needs from a runtime, and which runtime it gets.
 *
 * Two runtimes host the same conversation: `CliAgentRuntime` (the `claude` binary on the
 * user's machine, spoken to over stream-json) and `SdkAgentRuntime` (the Agent SDK in main).
 * Both satisfy this one interface, and the host holds nothing more specific than it — so the
 * panel, which only ever sees `AgentEvent`s, has no way to tell them apart.
 *
 * Not `AgentRuntime` from `@shared/agent`: that contract has `send` return an
 * `AsyncIterable` of the turn's events, which neither runtime implements. Events leave main
 * through a broadcast to every window, so a listener is the shape that actually exists; `send`
 * returns the new turn's `runId`, and `started` is always the first event emitted for it.
 *
 * No `electron` import here, so the selection logic runs under `pnpm test`.
 */

import type { AgentEvent } from '@shared/agent'

export interface HostedAgentRuntime {
  readonly id: string
  /** Subscribe to every event of every turn. Returns the unsubscribe. */
  onEvent(listener: (event: AgentEvent) => void): () => void
  /** Start a turn. Returns its `runId`; `started` is emitted before this returns. */
  send(text: string): string
  /** Abandon the current turn. Safe to call when nothing is running. */
  stop(): void
  dispose(): void
}

export type RuntimeKind = 'cli' | 'sdk'

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
  return {
    ok: false,
    error: `${RUNTIME_ENV} is set to "${value}", which is not a runtime bay has. Use "cli" (the default) or "sdk", or unset it.`
  }
}
