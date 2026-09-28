import type { ToolSpec } from './spec'
import { WAIT_TOOL_TIMEOUT_MS, waitSeconds } from './fields'

export const order = 330

export const tool: ToolSpec = {
  name: 'track_export',
  description:
    'Progress of an export job: stage, frames done, and the output path once it lands. It ' +
    'waits for the export to finish before answering — up to waitSeconds (default 30, at most ' +
    '120) — and returns the moment it is done, failed or cancelled, with `waited` saying how long ' +
    'it held. So one call with waitSeconds: 120 replaces a whole loop of checks: never call it ' +
    'back to back. A result that is still `finished: false` means call it again the same way, ' +
    'not faster. A finished export reports `complete`: false (with ' +
    '`incompleteFrames` and a `warning` naming the frames and what is wrong on them) when some ' +
    'frames were written before a graphic on them had rendered, or with a clip whose grade ' +
    'could not be applied — do not report such an export as correct; the warning says what to ' +
    'do next.',
  category: 'read',
  readOnly: true,
  timeoutMs: WAIT_TOOL_TIMEOUT_MS,
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'The jobId export_timeline returned.' },
      waitSeconds: waitSeconds('the export to finish')
    },
    required: ['jobId']
  }
}
