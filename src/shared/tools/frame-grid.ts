import type { ToolSpec } from './spec'
import { frames } from './fields'
import { DEFAULT_GRID_CELLS, GRID_TOOL_TIMEOUT_MS, MAX_GRID_CELLS } from '../frame-grid'

export const order = 72

export const tool: ToolSpec = {
  name: 'frame_grid',
  description:
    'Watch a stretch of the edit at once: ONE image tiling evenly spaced frames, each labelled ' +
    'with its timecode and, when the clip has been transcribed, the words being said at that ' +
    'moment. Use it after an export or any big edit, before you say it is done — it is how you ' +
    'check that B-roll covers the line it was cut for, a caption or graphic lands on the right ' +
    'word, nothing flashes black between shots, and nothing covers a face. With no assetId it ' +
    'renders the timeline exactly as preview_frame does (fromFrame..toFrame, default the whole ' +
    'timeline); with assetId it shows a video file itself (fromSeconds..toSeconds of the source). ' +
    'Words appear only for sources already transcribed this session — call transcribe first to ' +
    'get them.',
  category: 'read',
  readOnly: true,
  timeoutMs: GRID_TOOL_TIMEOUT_MS,
  inputSchema: {
    type: 'object',
    properties: {
      fromFrame: frames('Timeline: first frame of the stretch. Default 0.'),
      toFrame: frames('Timeline: last frame of the stretch (inclusive). Default the last frame.'),
      assetId: { type: 'string', description: 'Show this video file instead of the timeline (from browse_assets).' },
      fromSeconds: { type: 'number', minimum: 0, description: 'With assetId: where in the file to start. Default 0.' },
      toSeconds: { type: 'number', minimum: 0, description: 'With assetId: where in the file to stop. Default its end.' },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_GRID_CELLS,
        description: `How many frames. Default ${DEFAULT_GRID_CELLS}; up to ${MAX_GRID_CELLS} for a long stretch, fewer to look closer.`
      }
    }
  }
}
