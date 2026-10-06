import type { ToolSpec } from './spec'

export const order = 222

export const tool: ToolSpec = {
  name: 'move_track',
  description:
    'Move a whole track up or down its stack, clips and all — the way to change which video ' +
    'layer draws over which without moving clips one by one. `position` is the track’s number ' +
    'among tracks of its kind: 1 is V1 (the lowest video layer, drawn first) or A1; the highest ' +
    'video number draws on top. Transitions, links and ducking are unaffected; clip timing does ' +
    'not change. A track still named by its number (“V2”) is renamed to its new one, a track ' +
    'you named keeps its name. To put one clip on another layer use edit_item with trackId instead.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      trackId: { type: 'string' },
      position: {
        type: 'integer',
        minimum: 1,
        description: 'Where the track goes among tracks of its kind, counting from 1 (V1 / A1).'
      }
    },
    required: ['trackId', 'position']
  }
}
