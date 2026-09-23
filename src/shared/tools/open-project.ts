import type { ToolSpec } from './spec'

export const order = 20

export const tool: ToolSpec = {
  name: 'open_project',
  description:
    'Open a project in the editor, from a filePath list_projects returned (or any .bay file). ' +
    'It replaces whatever is open. If the open project has unsaved changes this is refused ' +
    "rather than discarding them — ask the user to save, or to open the project themselves. " +
    'Opening is not an edit and cannot be undone; the new project starts with fresh history.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'Opening a project replaces the document the user is looking at; a dry run could not put it back.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to a .bay file.' }
    },
    required: ['filePath']
  }
}
