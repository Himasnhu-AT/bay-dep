import type { ToolSpec } from './spec'

export const order = 310

export const tool: ToolSpec = {
  name: 'undo',
  description:
    'Take back the last change. One agent edit is one undo step, so this reverses exactly ' +
    'what you last did — not the whole turn.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: { type: 'object', properties: {} }
}
