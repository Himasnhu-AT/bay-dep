import type { ToolSpec } from './spec'

export const order = 210

export const tool: ToolSpec = {
  name: 'remove_range',
  description:
    'Remove a span of time from the timeline and close the hole, keeping every unlocked ' +
    'track in step. This is the cut you want for trimming a recording: give it the frames to ' +
    'drop and it splits whatever clips straddle the boundaries, discards what is inside, and ' +
    'pulls everything after it backwards by the same amount on every track at once. ' +
    'fromFrame is the first frame removed and toFrame is the first frame kept, so two calls ' +
    'sharing a bound remove exactly the union and neither drops a frame twice. ' +
    'Prefer this over delete_items when the thing you want gone is a passage rather than a ' +
    'clip — it can cut the middle out of a single long take, which delete_items cannot ' +
    'express at all. A locked track cannot be shifted, so if one holds content after the ' +
    'cut the result names it under desyncedTracks and that track is now adrift.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      fromFrame: { type: 'number' },
      toFrame: { type: 'number' }
    },
    required: ['fromFrame', 'toFrame']
  }
}
