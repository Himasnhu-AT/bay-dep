/**
 * What a tool is. Its own module so the tool files and `../mcp.ts` — which re-exports this —
 * do not import each other.
 */

export type ToolCategory = 'read' | 'write' | 'submit'

export interface ToolSpec {
  name: string
  /**
   * What the tool does, written for the model rather than for a reader of this file. Say
   * when to reach for it, not only what it does — a catalog entry that describes mechanism
   * without occasion gets used in the wrong place.
   */
  description: string
  category: ToolCategory
  /** Answers a question without changing anything. Safe to call speculatively. */
  readOnly: boolean
  /**
   * Accepts `validateOnly: true`: run against the real project, report what it would return,
   * and put the project and its undo history back exactly as they were.
   *
   * Only for tools whose every effect lands in the project document or the editor's session
   * state, because that is all the executor can put back. A file written, a job started or a
   * path registered with main is outside the store and a restore cannot reach it — a dry run
   * that wrote the file anyway would be a lie about the one thing it promises.
   *
   * The `validateOnly` property is not written into any tool's schema: `publishedSchema` adds
   * it from this flag, so the manifest, the validator and the gate cannot disagree about which
   * tools take it.
   */
  dryRunnable?: boolean
  /**
   * Why a tool that changes something cannot be dry-run, in the words an agent reads when it
   * asks. Every write tool carries either `dryRunnable: true` or this — asserted in the test —
   * so a new write tool cannot arrive with neither and answer a dry run with a bare "no".
   */
  dryRunRefusal?: string
  /** How long main waits for an answer, when longer than `MCP_CALL_TIMEOUT_MS`. */
  timeoutMs?: number
  /** JSON Schema for the arguments. Plain data so no validator leaks into `shared/`. */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
