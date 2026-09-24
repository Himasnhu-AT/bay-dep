import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 36

export const tool: ToolSpec = {
  name: 'detect_cuts',
  description:
    'Find the shot changes (scene cuts) inside a video file, on this Mac. Reach for it before ' +
    'cutting a long take or a supplied edit into shots, choosing B-roll that starts on a clean ' +
    'shot, or checking where a source already cuts. Pass itemId for a clip on the timeline: cuts ' +
    'come back as timeline frames for that clip (only the ones it plays). Pass assetId for a whole ' +
    'file: seconds from its start, plus timeline frames for every placement of it on the timeline. ' +
    'Each cut carries a score (0–100): a hard cut scores high, a fast pan or a flash may score ' +
    'just over the threshold — look at it with frame_grid before cutting on a low one.',
  category: 'read',
  readOnly: true,
  timeoutMs: 10 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'A video clip on the timeline. ' + itemId.description },
      assetId: { type: 'string', description: 'An imported video file, from browse_assets.' },
      threshold: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description:
          'How big a change counts as a cut. Default 10; lower finds dissolves and soft cuts along with more false ones, higher only hard cuts.'
      }
    }
  }
}
