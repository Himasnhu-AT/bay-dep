import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 296

export const tool: ToolSpec = {
  name: 'add_comment',
  description:
    'Leave the user a review comment at a point (or over a span) of the timeline — a question ' +
    'or something for them to check ("is this the take you wanted?", "the music clips here"). ' +
    'It shows as a pin on the ruler and stays open until someone resolves it. For your own ' +
    'notes in time use add_marker; a comment is addressed to the user.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What the comment says.' },
      frame: frames('Where it goes. Defaults to the playhead.'),
      endFrame: frames('Exclusive end, for a comment about a span. Must be after frame.')
    },
    required: ['text']
  }
}
