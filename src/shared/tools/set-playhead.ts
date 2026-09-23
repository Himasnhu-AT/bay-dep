import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 300

export const tool: ToolSpec = {
  name: 'set_playhead',
  description:
    'Move the playhead, which is what the user is looking at and what frame-defaulting tools ' +
    'use. Cheap and safe; move it to where you are working so the user follows along.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'set_playhead moves what the user is looking at, not the project, so there is no ' +
    'document change to predict. Call it without validateOnly; the result reports the ' +
    'frame it actually landed on.',
  inputSchema: {
    type: 'object',
    properties: { frame: frames('Frame to move to.') },
    required: ['frame']
  }
}
