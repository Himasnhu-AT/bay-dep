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

import { TOOLS, VALIDATE_ONLY, findTool, type ToolSpec } from './mcp'
import type { Pin } from './pins'
import type { ChangeLine } from './diff'

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
  /** `pins` are what was pinned when it was sent, shown as chips; `text` is what was typed. */
  | { kind: 'user'; id: string; text: string; pins?: Pin[] }
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
  /**
   * What an agent turn changed, like a commit's diff. The project before and after lives in the
   * store (`agentCheckpoints`), keyed by `id`, so a transcript export does not carry whole
   * projects. `reverted` once the user took it back — directly, or by reverting an earlier one;
   * back to `applied` if they undo that revert. `expired` when it can no longer be reverted:
   * another project was opened, or it fell out of the checkpoints bay keeps.
   *
   * `note` carries what the lines cannot, such as "this turn includes edits you made while the
   * agent was working" — the reason a revert may take more than the agent's work.
   */
  | {
      kind: 'changes'
      id: string
      lines: ChangeLine[]
      state: 'applied' | 'reverted' | 'expired'
      note?: string
    }

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
 * - `null` — **nothing is gated.** Either no in-app agent is driving — bay answering Claude
 *   Code over the socket, where the person is in a terminal watching every call go past and
 *   there is no panel to approve anything in; gating that would not make it safer, it would
 *   make it impossible — or an in-app session is running with "Ask before editing" off (the
 *   default), where the agent edits directly and each turn's Changes card, with its Revert, is
 *   the review.
 * - `{ approved: null }` — an in-app agent session is running with "Ask before editing" on,
 *   and has had nothing approved yet. Writes are refused, and the refusal says to propose first.
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

  // A dry run changes nothing, so there is nothing to approve — and gating it would forbid the
  // one move that lets an agent check a plan *before* putting it in front of the user. Only for
  // tools the catalog marks dry-runnable: on any other tool the flag is refused by the executor,
  // and a gate that waved it through would be trusting that refusal to happen. No `index`, so
  // nothing is spent.
  if (args[VALIDATE_ONLY] === true && findTool(toolName)?.dryRunnable) return { allowed: true }

  const approved = gate.approved
  if (!approved) {
    return {
      allowed: false,
      refusal:
        `"${toolName}" changes the project, and nothing has been approved in this ` +
        `conversation yet. Propose it first: call propose_edit with what you intend and the ` +
        `exact calls it needs, then end your turn and wait for the user to approve. Reading tools ` +
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
      'change, stop and call propose_edit again rather than substituting another call.'
  )
  return lines.join(' ')
}

// ---------------------------------------------------------------------------
// Building a proposal from what the agent sent
// ---------------------------------------------------------------------------

/** The most options a proposal may offer. More than this is a menu, not a decision. */
export const MAX_PROPOSAL_OPTIONS = 4
/** The most operations one option may carry. A plan longer than this should be staged. */
export const MAX_PROPOSAL_OPERATIONS = 60

/** How bay's tools are named by a client that namespaces them. Accepted and stripped. */
const CLIENT_PREFIX = 'mcp__bay__'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turn `propose_edit`'s arguments into a `Proposal`, or say exactly what is wrong with them.
 *
 * Every operation is checked **now**, against the same schema the executor will check it
 * against later, and that is the point of doing it here: a proposal whose third operation has a
 * typo'd field would be approved, and then refused mid-run with half the plan applied. The user
 * approved a plan that could never have been carried out, and nothing told them.
 *
 * Reads are refused inside a proposal rather than silently accepted. They need no approval, so
 * listing one teaches the model something false about the gate — and an approved read would be
 * a spent operation that did nothing, which makes "every approved operation has been carried
 * out" a sentence the gate could no longer say truthfully.
 *
 * `validate` is injected because the schema validator lives with the executor in the renderer;
 * `newId` because ids are the store's business, and a test wants them predictable.
 */
export function buildProposal(
  raw: Record<string, unknown>,
  validate: (tool: ToolSpec, args: Record<string, unknown>) => string | null,
  newId: (prefix: string) => string
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  const question = typeof raw['question'] === 'string' ? raw['question'].trim() : ''
  if (!question) {
    return { ok: false, error: '"question" must say, in one line, what the user is deciding.' }
  }

  const rawOptions = raw['options']
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return {
      ok: false,
      error:
        '"options" must be a non-empty array of { label, summary, operations }. One option is ' +
        'fine when there is only one sensible plan.'
    }
  }
  if (rawOptions.length > MAX_PROPOSAL_OPTIONS) {
    return {
      ok: false,
      error:
        `A proposal offers at most ${MAX_PROPOSAL_OPTIONS} options, and this one has ` +
        `${rawOptions.length}. Keep the ones that are genuinely different choices.`
    }
  }

  const options: ProposalOption[] = []
  for (let o = 0; o < rawOptions.length; o += 1) {
    const where = `Option ${o + 1}`
    const option = rawOptions[o]
    if (!isRecord(option)) return { ok: false, error: `${where} must be an object.` }

    const label = typeof option['label'] === 'string' ? option['label'].trim() : ''
    if (!label) return { ok: false, error: `${where} needs a short "label".` }
    const named = `${where} ("${label}")`
    const summary = typeof option['summary'] === 'string' ? option['summary'].trim() : ''
    if (!summary) {
      return {
        ok: false,
        error: `${named} needs a "summary": what it does, in the user's terms, without tool names.`
      }
    }

    const rawOps = option['operations']
    if (!Array.isArray(rawOps) || rawOps.length === 0) {
      return {
        ok: false,
        error: `${named} needs "operations": the exact calls, as [{ tool, args }], in order.`
      }
    }
    if (rawOps.length > MAX_PROPOSAL_OPERATIONS) {
      return {
        ok: false,
        error:
          `${named} has ${rawOps.length} operations; the most one option may carry is ` +
          `${MAX_PROPOSAL_OPERATIONS}. Propose the first stage, carry it out, then propose the next.`
      }
    }

    const operations: ProposalOperation[] = []
    for (let i = 0; i < rawOps.length; i += 1) {
      const at = `${named}, operation ${i + 1}`
      const rawOp = rawOps[i]
      if (!isRecord(rawOp)) return { ok: false, error: `${at} must be { tool, args }.` }
      const given = typeof rawOp['tool'] === 'string' ? rawOp['tool'] : ''
      const tool = given.startsWith(CLIENT_PREFIX) ? given.slice(CLIENT_PREFIX.length) : given
      const spec = findTool(tool)
      if (!spec) {
        const writes = TOOLS.filter((t) => !t.readOnly).map((t) => t.name)
        return {
          ok: false,
          error: `${at}: there is no tool "${given}". Tools that can be proposed: ${writes.join(', ')}.`
        }
      }
      if (!requiresApproval(spec.name)) {
        return {
          ok: false,
          error:
            `${at}: ${spec.name} only reads, and reads need no approval. Call it directly ` +
            `before proposing, and leave it out of the plan.`
        }
      }
      const args = rawOp['args'] === undefined ? {} : rawOp['args']
      if (!isRecord(args)) return { ok: false, error: `${at}: "args" must be an object.` }
      if (args[VALIDATE_ONLY] === true) {
        // An approved dry run would put a card in front of the user whose Approve button
        // changes nothing — a control that does nothing, presented as a decision.
        return {
          ok: false,
          error:
            `${at} (${spec.name}) is a dry run (validateOnly: true), and dry runs need no ` +
            `approval. Make that call directly now if you want its answer, and propose the ` +
            `real call without validateOnly.`
        }
      }
      const invalid = validate(spec, args)
      if (invalid) {
        return {
          ok: false,
          error:
            `${at} (${spec.name}) would be refused when carried out: ${invalid} ` +
            `Fix it before proposing — an approved plan that cannot run is worse than none.`
        }
      }
      operations.push({ index: i, tool: spec.name, args })
    }

    options.push({ id: newId('opt'), label, summary, operations })
  }

  return { ok: true, proposal: { id: newId('prp'), question, options } }
}

/**
 * What the agent is told when the user approves, as the next message of the conversation.
 *
 * The approval has to *reach* the model as a turn, not only change the gate: the CLI runtime
 * has no side channel into a conversation, and a model told to wait for approval is, correctly,
 * no longer running. The operations are repeated in full because they are what the gate will
 * match against, byte for byte, and a model working from its memory of what it proposed is a
 * model that drifts an argument.
 */
export function approvalMessage(option: ProposalOption): string {
  const lines = option.operations.map(
    (op) => `${op.index + 1}. ${op.tool} ${JSON.stringify(op.args)}`
  )
  return [
    `Approved: "${option.label}".`,
    '',
    'Carry out exactly these calls, in this order, with these arguments:',
    ...lines,
    '',
    'If one is refused or the timeline is not what you expected, stop and tell me rather than ' +
      'substituting another call. When they are done, look at the result before you report it.'
  ].join('\n')
}

/** What the agent is told when the user turns every option down. */
export const DECLINED_MESSAGE =
  'I am not approving any of those options. Nothing was changed. Ask me what I would prefer, ' +
  'or propose something different.'
