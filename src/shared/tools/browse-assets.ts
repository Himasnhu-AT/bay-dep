import type { ToolSpec } from './spec'

export const order = 50

export const tool: ToolSpec = {
  name: 'browse_assets',
  description:
    'The media pool: what has been imported, with duration, dimensions, whether it carries ' +
    'audio, and whether it could be read at all. An asset with an `error` cannot be placed ' +
    'and re-importing it will not help — say so rather than retrying.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} }
}
