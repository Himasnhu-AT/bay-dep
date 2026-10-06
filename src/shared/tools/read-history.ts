import type { ToolSpec } from './spec'

export const order = 308

export const tool: ToolSpec = {
  name: 'read_history',
  description:
    'List the undo history: every change still reachable by undo or redo, oldest first, each ' +
    'with what it did, who made it (the user, you, or an MCP client) and its position. Read it ' +
    'before undoing more than one step, or to find the point before something went wrong; ' +
    'then call undo with that position. Position 0 is the project before the first change ' +
    'listed. The history holds the last 100 changes of this session and is not saved with the project.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} }
}
