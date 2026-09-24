import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 60

export const tool: ToolSpec = {
  name: 'inspect_item',
  description:
    'Everything about one placed item: timing, the layout rectangle on the canvas, opacity, ' +
    'volume, fades, speed, and which asset it draws from. Read this before editing an item ' +
    'you did not just create — the user may have moved it since.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: { itemId }, required: ['itemId'] }
}
