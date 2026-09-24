import type { ToolSpec } from './spec'

export const order = 240

export const tool: ToolSpec = {
  name: 'remove_transition',
  description:
    'Take a transition off a cut, leaving the clips and their timing untouched — the cut ' +
    'becomes a straight one again.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: { transitionId: { type: 'string' } },
    required: ['transitionId']
  }
}
