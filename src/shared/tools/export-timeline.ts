import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 320

export const tool: ToolSpec = {
  name: 'export_timeline',
  description:
    'Render the timeline to a file. Returns a job id immediately — encoding a long timeline ' +
    'takes minutes, so poll track_export rather than waiting. Check the result before ' +
    'telling the user it is done: an export can finish with no frames if the timeline is ' +
    'empty over the range you asked for.',
  category: 'submit',
  readOnly: false,
  dryRunRefusal:
    'export_timeline starts an encode that writes a file, which a dry run cannot take ' +
    'back. Check the range with preview_frame at its first and last frames instead.',
  inputSchema: {
    type: 'object',
    properties: {
      outputPath: { type: 'string', description: 'Absolute path, with extension.' },
      format: { type: 'string', enum: ['mp4', 'mov', 'webm', 'wav', 'mp3'] },
      fromFrame: frames('First frame. Defaults to 0.'),
      toFrame: frames('Last frame, inclusive. Defaults to the end of the timeline.')
    },
    required: ['outputPath', 'format']
  }
}
