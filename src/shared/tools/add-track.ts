import type { ToolSpec } from './spec'

export const order = 220

export const tool: ToolSpec = {
  name: 'add_track',
  description:
    'Add a video or audio track. Video tracks stack — a later one draws over the ones before ' +
    'it — so an overlay needs its own track above the clip it covers, not a free slot on the ' +
    'same one.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['video', 'audio'] } },
    required: ['kind']
  }
}
