import type { ToolSpec } from './spec'

export const order = 96

export const tool: ToolSpec = {
  name: 'read_brf',
  description:
    'The source of a .brf motion asset, exactly as write_brf will accept it back — read it, change ' +
    'what you need, and pass it to write_brf with the same assetId. Also says how many placements ' +
    'it has, since a replace changes all of them.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', description: 'A .brf asset, from browse_assets, inspect_item or write_brf.' }
    },
    required: ['assetId']
  }
}
