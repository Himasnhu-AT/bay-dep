import type { ToolSpec } from './spec'

export const order = 200

export const tool: ToolSpec = {
  name: 'delete_items',
  description:
    'Remove whole items from the timeline. Leaves a gap by default; pass ripple to close it ' +
    'by pulling later items on the same track backwards. Ripple here never touches other ' +
    'tracks, so it will desynchronise anything layered above or below unless you move that ' +
    'too. To remove a stretch of time rather than a list of clips — and to keep every track ' +
    'in sync while doing it — use remove_range instead. A clip linked to others (a picture ' +
    'and its detached sound) is deleted with them; the result lists them as linkedAlsoDeleted. ' +
    'To delete only one, detach_audio { action: "unlink" } first.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: { type: 'array', items: { type: 'string' } },
      ripple: { type: 'boolean' }
    },
    required: ['itemIds']
  }
}
