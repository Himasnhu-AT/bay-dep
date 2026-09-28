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
 * How long a status tool may hold its answer for a job to finish. A model cannot sleep, so
 * "poll on a sensible interval" meant back-to-back calls: measured, 176 `track_export` calls in
 * one turn for a 62 s export, every result in context ($11.89). The tool waits instead.
 *
 * 30 s by default: long enough that a short export or an image lands in one call and a long one
 * costs a call every half minute, short enough that the agent can still say how far along it is.
 * 120 s at most, well under the call's own budget (`WAIT_TOOL_TIMEOUT_MS`) and the agents' tool
 * timeouts, which are derived from the longest `timeoutMs` in the catalog.
 */
export const WAIT_DEFAULT_SECONDS = 30
export const WAIT_MAX_SECONDS = 120

/** Main's budget for a call that may wait: the longest wait plus a minute for the answer itself. */
export const WAIT_TOOL_TIMEOUT_MS = (WAIT_MAX_SECONDS + 60) * 1000

export const waitSeconds = (what: string): Record<string, unknown> => ({
  type: 'number',
  minimum: 0,
  maximum: WAIT_MAX_SECONDS,
  description:
    `Seconds to wait for ${what} before answering (0–${WAIT_MAX_SECONDS}, default ` +
    `${WAIT_DEFAULT_SECONDS}). The call returns the moment it finishes, so a long wait costs ` +
    'nothing when the job is quick. Pass this instead of calling repeatedly; 0 answers at once.'
})
