import type { ToolSpec } from './spec'

export const order = 285

export const tool: ToolSpec = {
  name: 'mark_highlights',
  description:
    'Put your chosen highlight clips on the timeline as markers — one at each start, labelled with ' +
    'its rank, title and score, and one at each end — after checking them. Every pick is checked ' +
    'before any marker is placed: a title, whole frames, the end after the start, inside the ' +
    'timeline, no two overlapping, and (when you pass minSeconds/maxSeconds) the length in range; ' +
    'a refusal lists every fault at once. With scores, the result ranks the clips by the focus\'s ' +
    'weighting. One undo step. Frames are timeline frames, as find_highlights gives them for a clip. ' +
    'To cut the timeline down to the picks afterwards, remove_range the gaps between them, last first.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      highlights: {
        type: 'array',
        items: { type: 'object' },
        description:
          '[{ title, fromFrame, toFrame, scores?: { hook, information, emotion, completeness }, reason? }] — ' +
          'fromFrame/toFrame on sentence edges from find_highlights, toFrame half-open.'
      },
      focus: {
        type: 'string',
        enum: ['balanced', 'viral', 'knowledge'],
        description: 'The weighting to rank by. Use the one you scored with. Default balanced.'
      },
      minSeconds: { type: 'number', minimum: 0, description: 'Refuse a pick shorter than this.' },
      maxSeconds: { type: 'number', minimum: 0, description: 'Refuse a pick longer than this.' },
      color: { type: 'string', description: 'Hex marker colour. Default "#F5A524".' },
      ends: { type: 'boolean', description: 'Also mark where each clip ends. Default true.' }
    },
    required: ['highlights']
  }
}
