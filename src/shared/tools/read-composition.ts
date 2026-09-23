import type { ToolSpec } from './spec'

export const order = 120

export const tool: ToolSpec = {
  name: 'read_composition',
  description:
    'Read a composition back: its declared id, duration, size, variables and sounds, every ' +
    'fault with the line it is on, and optionally the HTML itself. `audio` lists the sounds ' +
    'that will play (<audio id src data-start> elements whose file exists locally); one that ' +
    'is missing, remote or undecodable is a fault instead. Use it to check what you wrote ' +
    'before placing it, and to inspect one you did not write before editing it. Faults are ' +
    'reported even when the composition is usable — the non-fatal ones are the ones that matter most, ' +
    'because a blocked network request renders as a still frame with nothing in any log.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the .html file.' },
      includeHtml: {
        type: 'boolean',
        description: 'Return the document text as well as its declared shape. Default false.'
      }
    },
    required: ['path']
  }
}
