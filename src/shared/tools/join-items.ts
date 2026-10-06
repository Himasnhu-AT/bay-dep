import type { ToolSpec } from './spec'

export const order = 192

export const tool: ToolSpec = {
  name: 'join_items',
  description:
    'Heal a through-edit: turn two clips that are one take with a cut in it back into one clip ' +
    '— the reverse of split_at. Use it to clean up after a split that was not needed, or after ' +
    'cuts whose removed material was put back. Name the clip on each side of the cut, or one ' +
    'clip to join it to the clip that follows it; name several to join every cut among them. ' +
    'Two clips join only if they are the same media, meet on the same frame of the same track, ' +
    'continue in the source exactly where the first leaves off, and are otherwise set the same ' +
    '(level, speed, layout, grade…). Anything else is a real cut: it is left alone and the ' +
    'answer says what differs. The joined clip keeps the first clip’s id. Linked clips (a ' +
    'picture and its detached sound) are joined together.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'The clips either side of each cut to remove. One id means that clip and the one after it.'
      },
      linked: {
        type: 'boolean',
        description: 'False joins only the clips named, leaving clips linked to them cut. Default true.'
      }
    },
    required: ['itemIds']
  }
}
