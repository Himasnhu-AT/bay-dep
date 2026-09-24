import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 190

export const tool: ToolSpec = {
  name: 'split_at',
  description:
    'Cut every item crossing a frame into two, or only the items you name. A cut exactly on ' +
    'an item edge does nothing — it would make a zero-length clip — and is reported rather ' +
    'than silently skipped.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      frame: frames('Where to cut. Defaults to the playhead.'),
      itemIds: { type: 'array', items: { type: 'string' } }
    }
  }
}
