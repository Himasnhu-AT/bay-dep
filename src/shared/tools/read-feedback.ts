import type { ToolSpec } from './spec'

export const order = 292

export const tool: ToolSpec = {
  name: 'read_feedback',
  description:
    'The review comments on the timeline — notes the user left at points in the edit ("this cut ' +
    'is late", "louder here") for you to act on. Each comes with its id, frame (and endFrame for ' +
    'a span), timecode, text, author, and the items under that frame, so you can go straight to ' +
    'the fix. Open comments only unless `include: "all"`. Reach for it when the user asks you to ' +
    'address their comments or fix the notes; fix each one, then resolve_feedback with a note ' +
    'saying what you did.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      include: {
        type: 'string',
        enum: ['open', 'all'],
        description: '"open" (default) for comments still to address; "all" adds resolved ones and their notes.'
      }
    }
  }
}
