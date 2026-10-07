/**
 * `agent_turn`'s counts, out of `host.ts` (which imports Electron) so the test can drive it with
 * the real stream mapping.
 *
 * The `claude` CLI and the Agent SDK run with `--include-partial-messages`, so one tool call
 * arrives as a `tool` event **twice** — once as its block starts streaming, once in the settled
 * assistant message — under the same `callId`. A turn's count is therefore of distinct call ids,
 * not of events.
 */

import type { AgentEvent } from '@shared/agent'

export interface TurnCount {
  toolCalls: number
  ok: boolean
}

/** Feed it every event of a runtime; it calls `report` once per turn that ends. */
export function turnCounter(report: (count: TurnCount) => void): (event: AgentEvent) => void {
  const calls = new Map<string, Set<string>>()
  return (event) => {
    if (event.type === 'started') calls.set(event.runId, new Set())
    else if (event.type === 'tool') {
      const seen = calls.get(event.runId) ?? new Set<string>()
      seen.add(event.callId)
      calls.set(event.runId, seen)
    } else if (event.type === 'done') {
      report({ toolCalls: calls.get(event.runId)?.size ?? 0, ok: event.reason === 'complete' })
      calls.delete(event.runId)
    }
  }
}
