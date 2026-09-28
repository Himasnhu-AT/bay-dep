import type { ToolSpec } from './spec'

export const order = 214

export const tool: ToolSpec = {
  name: 'set_item_enabled',
  description:
    'Switch clips off (enabled: false) or back on without removing them. A disabled clip stays on ' +
    'the timeline where it was, but neither draws nor sounds — in the viewer, preview_frame and the ' +
    'export alike — so it is the non-destructive way to try a version without a shot, mute one ' +
    'take, or keep an alternative angle in place. A clip\'s linked partners (a picture and its ' +
    'detached sound) switch with it unless linked: false, which lets a picture go dark while its ' +
    'sound keeps playing. Clips on locked tracks are refused by name. The result lists what ' +
    'changed; a clip already in the asked state is reported as unchanged, not as an error.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Item ids from read_project. The first 10 characters are enough.'
      },
      enabled: { type: 'boolean', description: 'false switches them off; true switches them back on.' },
      linked: {
        type: 'boolean',
        description: 'Also switch each clip\'s linked partners (default true, as the timeline\'s own Enable/Disable does).'
      }
    },
    required: ['itemIds', 'enabled']
  }
}
