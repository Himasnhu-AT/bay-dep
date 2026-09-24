import type { ToolSpec } from './spec'

export const order = 294

export const tool: ToolSpec = {
  name: 'resolve_feedback',
  description:
    'Mark review comments done once you have addressed them, with a short note of what you ' +
    'changed — the user reads it on the comment. Pass `commentIds` and one `note` for comments ' +
    'fixed by the same change, or `resolutions: [{ commentId, note }]` for a note each. All of ' +
    'them resolve in one undo step; an unknown id refuses the whole call and names the open ' +
    'comments. Resolve only what you actually fixed; say in your reply what you could not.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      commentIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Comment ids from read_feedback. The first 10 characters are enough.'
      },
      note: { type: 'string', description: 'What was done, for every id in commentIds.' },
      resolutions: {
        type: 'array',
        items: { type: 'object' },
        description: '[{ commentId, note }] — one note per comment, in place of commentIds/note.'
      }
    }
  }
}
