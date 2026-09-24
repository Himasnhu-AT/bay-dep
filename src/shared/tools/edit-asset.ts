import type { ToolSpec } from './spec'

export const order = 150

export const tool: ToolSpec = {
  name: 'edit_asset',
  description:
    'Change an asset itself — and so every clip placing it at once. Two things are asset-level: ' +
    'its name (how it reads in the media pool and on its clips), and for a text asset the ' +
    'words it draws. Reach for it to fix a typo in a title everywhere it appears, or to give ' +
    'an import a useful name. Anything about one placement — timing, position, look, text ' +
    'styling — is edit_item. Duration, size and frame rate are measured from the file and ' +
    'cannot be set. The result lists usedBy: every item the change reached, so check it if ' +
    'you meant to change only one; to reword a single title, place a new text asset instead.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', description: 'Asset id from browse_assets or read_project.' },
      name: { type: 'string', description: 'The new display name.' },
      text: {
        type: 'string',
        description: 'Text assets only: the words to draw. Line breaks are kept.'
      }
    },
    required: ['assetId']
  }
}
