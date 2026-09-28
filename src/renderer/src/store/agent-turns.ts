/**
 * Agent turns as commits: what a revert needs, and the module state the store's edit path reads
 * to tell the agent's edits from the user's. See the store's `revertAgentChange`.
 */

import type { AgentEntry } from '@shared/agent'
import type { Project } from '@shared/project'
import type { EditorState } from './types'

/** One agent turn, as a revert needs it. */
export interface AgentCheckpoint {
  before: Project
  /** The project when the turn ended — what "has anything changed since?" compares against. */
  after: Project
  files: { path: string; before: string | null; after: string }[]
}

/** A revert, remembered so undo/redo can say which cards it touched. */
export interface AgentRevert {
  /** The project the revert put in place. */
  restored: Project
  /** The project it replaced. */
  replaced: Project
  ids: string[]
}

/** How many reverts bay keeps ready. Each holds two whole projects; older turns expire. */
export const MAX_AGENT_CHECKPOINTS = 20

/**
 * What reverting `id` would take with it, for the card to say before the click:
 * how many later agent turns, and whether the project has changed since those turns ended
 * (the user's own edits, which a revert discards too).
 */
export function revertImpact(state: EditorState, id: string): { laterTurns: number; laterEdits: boolean } {
  const index = state.agentLog.findIndex((e) => e.kind === 'changes' && e.id === id)
  if (index < 0) return { laterTurns: 0, laterEdits: false }
  const applied = state.agentLog.filter(
    (e, i): e is Extract<AgentEntry, { kind: 'changes' }> => i >= index && e.kind === 'changes' && e.state === 'applied'
  )
  const last = applied[applied.length - 1]
  const checkpoint = last ? state.agentCheckpoints[last.id] : undefined
  return {
    laterTurns: Math.max(0, applied.length - 1),
    laterEdits: checkpoint ? checkpoint.after !== state.project : false
  }
}

/**
 * Writes a file back during a revert (or its undo). Registered by the MCP executor, which owns
 * the bridge; a store with none registered — a test, a window without the bridge — reports that
 * the files could not be restored rather than pretending they were.
 */
type FileWriter = (path: string, contents: string) => Promise<{ ok: boolean; error?: string }>
let agentFileWriter: FileWriter | null = null
export function setAgentFileWriter(writer: FileWriter | null): void {
  agentFileWriter = writer
}

/**
 * Depth of tool calls currently running on the agent's behalf. An edit made while this is zero
 * during a turn is the user's own, and the turn's card says so — reverting the turn takes it
 * too, because the diff is between two whole projects.
 */
let agentActing = 0
export async function asAgent<T>(work: () => Promise<T> | T): Promise<T> {
  agentActing += 1
  try {
    return await work()
  } finally {
    agentActing -= 1
  }
}

/**
 * Depth of tool calls currently running for an MCP client on bay's socket — a terminal or another
 * app, not the in-app agent. An edit made while this is non-zero during a turn is the client's:
 * neither the agent's nor the user's, and the turn's card says so separately.
 */
let clientActing = 0
export async function asClient<T>(work: () => Promise<T> | T): Promise<T> {
  clientActing += 1
  try {
    return await work()
  } finally {
    clientActing -= 1
  }
}

/**
 * Runs `work` as time the calling tool call is not acting: its own depth is given back while
 * `work` runs and taken again after. For a call that waits on a job (`mcp/wait.ts`) — without
 * this, an edit the user makes while `track_export` sleeps is marked as the agent's.
 */
export async function stepAside<T>(who: 'agent' | 'client', work: () => Promise<T>): Promise<T> {
  if (who === 'agent') agentActing -= 1
  else clientActing -= 1
  try {
    return await work()
  } finally {
    if (who === 'agent') agentActing += 1
    else clientActing += 1
  }
}

/** How many MCP-client tool calls are running right now. */
export function clientActingDepth(): number {
  return clientActing
}

/** The registered file writer, for the store's revert path. */
export function agentFileWriterNow(): FileWriter | null {
  return agentFileWriter
}

/** How many agent tool calls are running right now. */
export function agentActingDepth(): number {
  return agentActing
}
