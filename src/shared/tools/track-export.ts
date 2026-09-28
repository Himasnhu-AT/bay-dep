import type { ToolSpec } from './spec'
import { WAIT_TOOL_TIMEOUT_MS, waitSeconds } from './fields'

export const order = 330

export const tool: ToolSpec = {
  name: 'track_export',
  description:
    'The result of an export job. It waits until the export is done, failed or cancelled (up to ' +
    '30 minutes) and then answers once, with the stage, the output path, `complete`, `findings` ' +
    'and the delivered loudness — export_timeline already does this by default, so you need it ' +
    'only for a job started with wait: false or one whose wait was cut short. waitSeconds sets a ' +
    'shorter upper bound; 0 reads the status at once. A finished export reports `complete`: false (with ' +
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
