import type { ToolSpec } from './spec'

export const order = 330

export const tool: ToolSpec = {
  name: 'track_export',
  description:
    'Progress of an export job: stage, frames done, and the output path once it lands. ' +
    'Poll on a sensible interval rather than in a tight loop; a render reports progress only ' +
    'as frames are encoded. A finished export reports `complete`: false (with ' +
    '`incompleteFrames` and a `warning` naming the frames and what is wrong on them) when some ' +
    'frames were written before a graphic on them had rendered, or with a clip whose grade ' +
    'could not be applied — do not report such an export as correct; the warning says what to ' +
    'do next.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { jobId: { type: 'string' } },
    required: ['jobId']
  }
}
