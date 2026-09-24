import type { ToolSpec } from './spec'

export const order = 290

export const tool: ToolSpec = {
  name: 'remove_marker',
  description:
    'Take a marker off the timeline. Nothing else changes. Marker ids come from read_project ' +
    'or add_marker; an unknown id is refused with the list of markers that do exist.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: { markerId: { type: 'string' } },
    required: ['markerId']
  }
}
