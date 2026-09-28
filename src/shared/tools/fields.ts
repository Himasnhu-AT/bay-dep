/**
 * Schema fragments more than one tool uses. Kept identical across tools on purpose: an agent
 * that learns what `itemId` means from one tool should find the same words in the next.
 */

export const frames = (description: string): Record<string, unknown> => ({
  type: 'integer',
  minimum: 0,
  description
})

export const itemId = {
  type: 'string',
  description:
    'Item id from read_project or inspect_item. The first 10 characters are enough; ' +
    'ids are never invented, always copied from a tool result.'
}

/**
 * How long a status tool holds its answer for a job to finish: by default, until it finishes.
 *
 * A model cannot sleep, so "check on an interval" meant back-to-back calls — measured, 176
 * `track_export` calls in one turn for a 62 s export ($11.89) — and even an opt-in 120 s wait
 * left the agent calling again ("Export at 40%. Still polling.", then 8 more). So the tools wait
 * until the job is done, failed or cancelled, and a call returns early only at this ceiling.
 *
 * 30 minutes: a long 4K export with loudness mastering runs for many minutes, and an answer that
 * comes back before it ends is an invitation to call again. Everything downstream is derived from
 * `WAIT_TOOL_TIMEOUT_MS`: main's per-call timeout (`timeoutMs`, read by `server.ts`), Codex's
 * `tool_timeout_sec` and the turn timeout (both from the catalog's largest `timeoutMs`), and the
 * Claude CLI's MCP tool timeouts (`MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in
 * `agent/cli.ts`'s `childEnv`). The proxy and the sockets have no timeout of their own.
 */
export const WAIT_CEILING_SECONDS = 30 * 60

/** A waiting call's budget: the ceiling plus two minutes for the answer itself (an import, a place). */
export const WAIT_TOOL_TIMEOUT_MS = (WAIT_CEILING_SECONDS + 120) * 1000

export const waitSeconds = (what: string): Record<string, unknown> => ({
  type: 'number',
  minimum: 0,
  maximum: WAIT_CEILING_SECONDS,
  description:
    `Optional upper bound, in seconds, on how long to wait for ${what}. Leave it out to wait until ` +
    `it finishes (up to ${WAIT_CEILING_SECONDS / 60} minutes). 0 reads the status at once without waiting.`
})
