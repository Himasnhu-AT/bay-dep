import type { ToolSpec } from './spec'

export const order = 10

export const tool: ToolSpec = {
  name: 'list_projects',
  description:
    'The projects bay knows about — name, file path and when each was last edited, newest ' +
    'first — and which one is open now, if any. bay opens on a projects screen with no ' +
    'project open; every other tool is refused until one is, and this plus open_project is ' +
    'how you get there.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} }
}
