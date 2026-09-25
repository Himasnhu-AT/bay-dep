/**
 * The agent surface: bay's project model exposed over the Model Context Protocol.
 *
 * The shape of this is decided by one fact — **the renderer owns the project.** The store is
 * the only thing that knows the current timeline, and every mutation must go through its
 * `edit()` so it lands on the undo stack and the user can take it back. So a tool call cannot
 * be answered by the main process alone: it arrives over stdio, crosses into main, crosses
 * again into the renderer, is applied to the store, and the result comes back the same way.
 *
 *     claude ──stdio──▶ bay --mcp ──unix socket──▶ main ──ipc──▶ renderer ──▶ store
 *
 * The proxy is a separate short-lived process rather than a server inside the app, for the
 * same reason ChatCut's is: an MCP client wants a command to spawn, and the app is a GUI that
 * may not be running yet. The proxy launches it if needed.
 *
 * Three rules this surface holds itself to, each learned from a control that did not do what
 * it said:
 *
 * 1. **Every tool listed here must work.** A tool that returns "not implemented" is worse
 *    than an absent one — the agent will plan around it, spend a turn, and discover the gap
 *    after telling the user it is done.
 * 2. **An error is a recovery instruction.** "Invalid id" tells an agent nothing it can act
 *    on; "no item `a1b2c3d4e5` on the active timeline — call `read_project` and use an id
 *    from its output" tells it exactly what to do next.
 * 3. **Time is frames.** The same rule as everywhere else in this codebase, and the place an
 *    agent is most likely to guess seconds. Tools that accept a time take a frame number, and
 *    say so in their description.
 */

import { TOOLS } from './tools/index'
import type { ToolSpec } from './tools/spec'

// ---------------------------------------------------------------------------
// The wire between main and the renderer
// ---------------------------------------------------------------------------

/**
 * One tool call travelling main → renderer.
 *
 * Electron has no main-side `invoke`, so the round trip is built by hand: main pushes a call
 * carrying an `id`, the renderer answers on the result channel with the same `id`. A call
 * that is never answered must reject rather than hang — a hang in this path would stall the
 * agent's turn with no verdict, which this project has already learned the cost of.
 */
export interface McpToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  /**
   * Which door the call came through: the in-app agent's socket (`'in-app'`), or a client on
   * bay's MCP socket (`'socket'` — a terminal, another app). Only the in-app agent's edits are
   * the agent turn's; a client's are marked as its own, and are not gated by the turn's
   * approvals. Absent means in-app (bay's own callers).
   */
  origin?: 'in-app' | 'socket'
}

export type McpToolResult =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string }

/** How long the renderer has to answer before main gives up and reports it as an error. */
export const MCP_CALL_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/**
 * Every tool, one file each in `./tools/`, collected by the generated `./tools/index.ts` in the
 * order the manifest lists them. To add a tool, add a file there and run `pnpm gen:tools`.
 */
export { TOOLS } from './tools/index'
export type { ToolCategory, ToolSpec } from './tools/spec'

/**
 * Whether bay can be driven over MCP, in the shape the bridge hands the renderer.
 *
 * Structurally identical to main's `SocketStatus` plus the live connection count, except that
 * the path is `socketPath` on this side. Declared here rather than imported from either end
 * because both ends need it and neither may import the other.
 */
export interface AgentSurfaceStatus {
  /** MCP clients are allowed (Preferences › Agent). Off is a choice, not a failure. */
  enabled: boolean
  ready: boolean
  error: string | null
  socketPath: string | null
  connectionsSeen: number
}

/**
 * The three states the UI has to tell apart, as one line.
 *
 * `waiting` and `failed` look identical from outside — nothing is happening either way — and
 * conflating them is how a subsystem that never worked survives as one nobody used. So the
 * wording is deliberately different in kind: a failure names a reason, waiting names the
 * socket path, because the path is what a user needs in order to configure a client.
 *
 * It lives in `shared/` for a reason worth keeping: the first version sat in
 * `main/mcp/socket-server.ts`, where the renderer — the only process with a status bar to put
 * it in — could not import it. It had no callers for as long as it existed, so the distinction
 * this function was written to draw was never once drawn on screen, in the subsystem whose
 * whole point is that a silent failure is indistinguishable from an idle success. The type was
 * designed carefully, the IPC was plumbed, and the sentence was written on the wrong side of
 * the process boundary.
 */
export function summariseAgentSurface(status: AgentSurfaceStatus): string {
  if (!status.enabled) return 'MCP clients are off — turn them on in Preferences › Agent to drive bay from a terminal or another app'
  if (!status.ready) return `Agent control unavailable — ${status.error ?? 'unknown reason'}`
  if (status.connectionsSeen === 0)
    return `Agent control ready — no agent has connected yet (${status.socketPath ?? 'no socket path'})`
  const n = status.connectionsSeen
  return `Agent control ready — ${n} connection${n === 1 ? '' : 's'} this session`
}

export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name)
}

// ---------------------------------------------------------------------------
// Dry runs
// ---------------------------------------------------------------------------

export const VALIDATE_ONLY = 'validateOnly'

const validateOnlyProperty = {
  type: 'boolean',
  description:
    'Dry run. true: check the call against the real project and return what it would ' +
    'return, as { validateOnly: true, wouldReturn }, without changing anything — no undo ' +
    'step, nothing marked unsaved. Needs no approval. A call that would be refused is ' +
    'refused the same way, so this is how to test a plan before proposing or making it.'
}

/** Whether a tool takes `validateOnly`: a store dry run, or one its own handler answers. */
export function acceptsValidateOnly(spec: ToolSpec): boolean {
  return spec.dryRunnable === true || spec.selfValidating === true
}

/**
 * The schema a tool is published and validated with: its own, plus `validateOnly` when the
 * catalog marks it dry-runnable.
 *
 * One function feeding the manifest and the validator, so the two cannot disagree — a tool
 * that advertised the flag and then refused it as an unknown argument would be a control that
 * does nothing, and one that accepted it unadvertised would be one no agent finds.
 */
export function publishedSchema(spec: ToolSpec): ToolSpec['inputSchema'] {
  if (!acceptsValidateOnly(spec)) return spec.inputSchema
  return {
    ...spec.inputSchema,
    properties: { ...spec.inputSchema.properties, [VALIDATE_ONLY]: validateOnlyProperty }
  }
}

/**
 * What a call asks for once `validateOnly` is read off it.
 *
 * - `run`: an ordinary call. `args` has `validateOnly: false` removed, so an approval made
 *   without the flag still matches a call that spells it out.
 * - `dry`: a dry run. `args` is what the handler receives — the flag removed, because no
 *   handler declares it and the dry run is the executor's business, not the tool's.
 * - `refused`: a dry run of a tool that cannot have one, with the reason.
 *
 * A non-boolean flag is left in place as a `run`, for the validator to name.
 */
export type DryRunRequest =
  | { mode: 'run'; args: Record<string, unknown> }
  | { mode: 'dry'; args: Record<string, unknown> }
  | { mode: 'refused'; error: string }

export function dryRunRequest(spec: ToolSpec, args: Record<string, unknown>): DryRunRequest {
  const flag = args[VALIDATE_ONLY]
  if (flag !== true && flag !== false) return { mode: 'run', args }
  const { [VALIDATE_ONLY]: _flag, ...rest } = args
  if (flag === false) return { mode: 'run', args: rest }
  if (spec.dryRunnable) return { mode: 'dry', args: rest }
  // The handler answers the flag itself, so it reaches the handler: `run`, flag kept.
  if (spec.selfValidating) return { mode: 'run', args: { ...rest, [VALIDATE_ONLY]: true } }
  if (spec.readOnly) {
    return {
      mode: 'refused',
      error:
        `${spec.name} only reads, so it already changes nothing — call it without validateOnly.`
    }
  }
  return {
    mode: 'refused',
    error:
      `${spec.name} cannot be dry-run. ${spec.dryRunRefusal ?? 'Its effects reach outside the project, where a dry run cannot put them back.'} ` +
      `Tools that accept validateOnly: ${TOOLS.filter(acceptsValidateOnly).map((t) => t.name).join(', ')}.`
  }
}

// ---------------------------------------------------------------------------
// Id matching
// ---------------------------------------------------------------------------

/**
 * Resolve an id an agent gave us against the ids that exist.
 *
 * Accepts a prefix because a full uuid is a lot of tokens to copy accurately, and a model
 * that retypes one will eventually retype it wrong. Ambiguity is an error rather than a
 * guess: two items matching a prefix means the agent is about to edit the wrong clip.
 */
export function resolveId(
  given: string,
  candidates: readonly string[]
): { ok: true; id: string } | { ok: false; error: string } {
  const needle = given.trim()
  if (needle.length === 0) return { ok: false, error: 'An id is required, but an empty string was given.' }

  const exact = candidates.find((id) => id === needle)
  if (exact) return { ok: true, id: exact }

  const matches = candidates.filter((id) => id.startsWith(needle))
  if (matches.length === 1) return { ok: true, id: matches[0]! }

  if (matches.length > 1) {
    return {
      ok: false,
      error:
        `"${needle}" matches ${matches.length} ids — it is too short to be unambiguous. ` +
        `Use more of the id: ${matches.map((m) => m.slice(0, 12)).join(', ')}.`
    }
  }
  return {
    ok: false,
    error:
      `No id starting with "${needle}" exists here. Ids are not guessable — copy one from the ` +
      `output of the tool that lists them (read_project for items and tracks, browse_assets for ` +
      `assets, read_feedback for comments).`
  }
}
