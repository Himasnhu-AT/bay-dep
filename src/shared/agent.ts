/**
 * The contract between bay and whatever is driving it as an agent.
 *
 * Two things live here, and they are separate on purpose.
 *
 * **`AgentRuntime` is how a conversation reaches bay.** Today that is the `claude` binary on
 * this machine, spoken to over stdio and pointed back at bay's own MCP socket; later it may be
 * the Agent SDK running in main. The panel must not be able to tell which — a UI that knows
 * how the model is hosted is a UI that has to be rewritten when the hosting changes, and the
 * hosting is the part most likely to change.
 *
 * **`ApprovedProposal` is what the user actually agreed to.** Not a mood, not a mode: a list of
 * concrete operations with concrete arguments, each usable once. The agent proposes, the user
 * approves an option, and from then on a write that does not match an unconsumed entry is
 * refused — with the approved list named in the refusal, because an agent that cannot see what
 * it may do will guess, and guessing is the thing being prevented.
 *
 * Why this rather than a prompt per tool call: a prompt per call is answered by reflex within
 * about three calls, and after that it is a button that means nothing. Approving a plan is a
 * decision someone actually makes, and it stays meaningful for the whole run because the guard,
 * not the user's attention, is what enforces it.
 */

import { TOOLS, type ToolSpec } from './mcp'

// ---------------------------------------------------------------------------
// What a runtime emits
// ---------------------------------------------------------------------------

/**
 * One thing that happened in a conversation, in the order it happened.
 *
 * Deliberately flat and serialisable: these cross a process boundary, and a class with methods
 * would arrive as a bare object with the methods gone — the kind of break that shows up as a
 * missing render rather than an error.
 */
export type AgentEvent =
  /** A run began. `runId` ties every later event to it, including across a reconnect. */
  | { type: 'started'; runId: string }
  /** Assistant prose, streamed. Append; never replace. */
  | { type: 'text'; runId: string; delta: string }
  /**
   * Reasoning, when the runtime exposes it. Separate from `text` because it is shown
   * differently and may be hidden entirely — collapsing the two means a setting that hides
   * thinking also hides the answer.
   */
  | { type: 'thinking'; runId: string; delta: string }
  /** A tool call began. `callId` pairs it with its result. */
  | { type: 'tool'; runId: string; callId: string; tool: string; args: Record<string, unknown> }
  /**
   * A tool call finished. `ok: false` carries the refusal text, which in this codebase is a
   * recovery instruction rather than a diagnosis, so it is shown to the user rather than
   * collapsed into a red icon.
   */
  | { type: 'tool-result'; runId: string; callId: string; ok: boolean; summary: string }
  /** The agent is asking for approval before it writes anything. */
  | { type: 'proposal'; runId: string; proposal: Proposal }
  /** The run ended. `reason` distinguishes a finished turn from a stop and from a failure. */
  | { type: 'done'; runId: string; reason: 'complete' | 'stopped' | 'error'; message?: string }

/**
 * A conversation with an agent, whatever is hosting it.
 *
 * `send` returns the events for that turn rather than taking a callback so a caller can `for
 * await` and stop by breaking — the shape that makes "the user hit stop" ordinary control flow
 * instead of a flag every implementation has to remember to check.
 */
export interface AgentRuntime {
  readonly id: string
  send(text: string): AsyncIterable<AgentEvent>
  /** Abandon the current turn. Safe to call when nothing is running. */
  stop(): void
  dispose(): void
}

/**
 * One thing in the conversation as the panel shows it.
 *
 * Not the same as an `AgentEvent`: events are what happened, entries are what is on screen.
 * Twenty text deltas are one entry; a tool call and its result are one entry that changes
 * state rather than two that must be paired up by eye.
 */
export type AgentEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | {
      kind: 'tool'
      /** The call id, so the result can find its own card. */
      id: string
      tool: string
      args: Record<string, unknown>
      state: 'running' | 'done' | 'failed'
      result?: string
    }
  | { kind: 'proposal'; id: string; proposal: Proposal }
  | { kind: 'error'; id: string; text: string }

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export interface ProposalOperation {
  /** Position in the option's list, and what `consumed` refers to. Stable across a render. */
  index: number
  tool: string
  args: Record<string, unknown>
}

export interface ProposalOption {
  id: string
  label: string
  /** What this option does, in the user's terms. Never tool names — they mean nothing here. */
  summary: string
  operations: readonly ProposalOperation[]
}

export interface Proposal {
  id: string
  /** The question the options answer, in one line. */
  question: string
  options: readonly ProposalOption[]
}

/**
 * Whether an approval regime is in force, and what it permits.
 *
 * Three states, one field, so they cannot disagree — each has its own sentence:
 *
 * - `null` — **nothing is gated.** No in-app agent is driving. This is bay answering Claude
 *   Code over the socket, where the person is in a terminal watching every call go past and
 *   there is no panel to approve anything in. Gating that would not make it safer, it would
 *   make it impossible.
 * - `{ approved: null }` — an in-app agent session is running and has had nothing approved
 *   yet. Writes are refused, and the refusal says to propose first.
 * - `{ approved: … }` — the user approved a plan. Exactly that plan may run, once each.
 *
 * The gate therefore prevents an agent from **deviating from what was approved**; it is not a
 * requirement that every edit be approved. That is the distinction that took a broken probe
 * run to see: the first version refused when nothing was approved regardless of who was
 * asking, which locked out the surface bay already ships.
 */
export interface AgentGate {
  approved: ApprovedProposal | null
}

export interface ApprovedProposal {
  approvalId: string
  proposalId: string
  option: ProposalOption
  /** Indices already spent. One approval is not a standing permission to repeat an edit. */
  consumed: number[]
}

/**
 * The tools an approval is required for.
 *
 * Derived from the catalog's own `readOnly` flag rather than listed here, because a list is a
 * second place to forget: a write tool added without touching this file would otherwise be
 * ungated, and nothing would report it. Reads stay free — an agent that must ask permission to
 * *look* cannot check its own work, and checking its own work is most of what makes it useful.
 */
export function requiresApproval(toolName: string): boolean {
  const spec: ToolSpec | undefined = TOOLS.find((t) => t.name === toolName)
  // An unknown tool is gated, not waved through. The catalog and the executor are edited by
  // different people, and the safe side of that disagreement is refusing.
  if (!spec) return true
  return !spec.readOnly
}

/**
 * Compare arguments for approval purposes.
 *
 * Structural, order-independent for object keys, and exact on values. Not a subset check:
 * approving `{itemId: 'x', volume: 0.5}` must not authorise `{itemId: 'x', volume: 0.5,
 * speed: 2}`, because the extra field is exactly where an unapproved edit would hide.
 *
 * `undefined` and an absent key are treated as the same thing, since a tool call built from a
 * partial object and one built from an explicit `undefined` are the same call.
 */
export function argsMatch(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export interface ApprovalVerdict {
  allowed: boolean
  /** Which operation this consumed, so the caller can mark it spent. Absent when refused. */
  index?: number
  /**
   * Why not, written for the agent to act on.
   *
   * Carries the approved operations in full. A refusal that only says "not approved" leaves an
   * agent with one move — try something else — which is the improvisation the gate exists to
   * stop. Told what it *may* do, it can either do that or stop and ask.
   */
  refusal?: string
}

/**
 * May this call run?
 *
 * Pure, and takes the approval rather than reading it from anywhere, so the whole gate is
 * testable without a store, a socket or a window.
 */
export function checkApproval(
  toolName: string,
  args: Record<string, unknown>,
  gate: AgentGate | null
): ApprovalVerdict {
  // No agent session is driving: this is the socket, and the person is watching it.
  if (!gate) return { allowed: true }
  if (!requiresApproval(toolName)) return { allowed: true }

  const approved = gate.approved
  if (!approved) {
    return {
      allowed: false,
      refusal:
        `"${toolName}" changes the project, and nothing has been approved in this ` +
        `conversation yet. Propose the edit first: describe what you intend to do and the ` +
        `exact calls it needs, and wait for the user to approve one option. Reading tools ` +
        `(${readableToolNames()}) need no approval — use them to plan.`
    }
  }

  const spent = new Set(approved.consumed)
  const match = approved.option.operations.find(
    (op) => !spent.has(op.index) && op.tool === toolName && argsMatch(args, op.args)
  )
  if (match) return { allowed: true, index: match.index }

  return { allowed: false, refusal: describeMismatch(toolName, args, approved) }
}

function readableToolNames(): string {
  return TOOLS.filter((t) => t.readOnly)
    .map((t) => t.name)
    .join(', ')
}

function describeMismatch(
  toolName: string,
  args: Record<string, unknown>,
  approved: ApprovedProposal
): string {
  const spent = new Set(approved.consumed)
  const remaining = approved.option.operations.filter((op) => !spent.has(op.index))
  const sameTool = remaining.filter((op) => op.tool === toolName)

  const lines = [
    `"${toolName}" does not match anything still approved under "${approved.option.label}".`
  ]

  if (sameTool.length > 0) {
    // The most common miss by far: right tool, arguments drifted. Show the difference rather
    // than the whole list, because the whole list buries it.
    lines.push(
      `You called it with ${JSON.stringify(args)}.`,
      `Approved with ${sameTool.map((op) => `#${op.index + 1} ${JSON.stringify(op.args)}`).join('; ')}.`
    )
  } else if (remaining.length > 0) {
    lines.push(
      `Still approved: ${remaining.map((op) => `#${op.index + 1} ${op.tool} ${JSON.stringify(op.args)}`).join('; ')}.`
    )
  } else {
    lines.push('Every approved operation has already been carried out.')
  }

  lines.push(
    'If the timeline turned out differently than the proposal assumed, or the edit needs to ' +
      'change, stop and propose again rather than substituting another call.'
  )
  return lines.join(' ')
}
