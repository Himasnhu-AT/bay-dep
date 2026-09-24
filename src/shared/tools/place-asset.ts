import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 140

export const tool: ToolSpec = {
  name: 'place_asset',
  description:
    'Put an asset on the timeline. Chooses a track with room unless you name one, and picks ' +
    'video or audio by what the asset carries. The clip takes its full source duration; trim ' +
    'it afterwards with edit_item rather than trying to place a portion. ' +
    'Returns the new item complete — id, track, timing and layout. **That returned state is ' +
    'authoritative: you do not need to call read_project to confirm it.**',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', description: 'Asset id from browse_assets or import_media.' },
      atFrame: frames('Where it starts. Defaults to the playhead.'),
      trackId: { type: 'string', description: 'Optional. Omit to let bay choose a free track.' }
    },
    required: ['assetId']
  }
}
