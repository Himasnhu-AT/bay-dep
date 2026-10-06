import type { ToolSpec } from './spec'

export const order = 310

export const tool: ToolSpec = {
  name: 'undo',
  description:
    'Take back the last change. One agent edit is one undo step, so this reverses exactly ' +
    'what you last did — not the whole turn. To go back (or forward again) more than one step, ' +
    'pass `position` from read_history: the project is stepped to that point in the history, ' +
    'undoing or redoing as many changes as that takes.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      position: {
        type: 'integer',
        minimum: 0,
        description:
          'A position from read_history: how many of the listed changes stay applied. 0 is before the first. Omit to undo one step.'
      }
    }
  }
}
