import type { ToolSpec } from './spec'

export const order = 330

export const tool: ToolSpec = {
  name: 'track_export',
  description:
    'Progress of an export job: stage, frames done, and the output path once it lands. ' +
    'Poll on a sensible interval rather than in a tight loop; a render reports progress only ' +
    'as frames are encoded.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { jobId: { type: 'string' } },
    required: ['jobId']
  }
}
