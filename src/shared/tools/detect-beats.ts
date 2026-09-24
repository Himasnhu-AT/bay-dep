import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 35

export const tool: ToolSpec = {
  name: 'detect_beats',
  description:
    'Find the beat of a piece of music on this Mac — tempo (BPM), every beat, the first beat of ' +
    'each bar, and where the drums drop out or the music goes silent. Reach for it before cutting ' +
    'to music: cuts that land on beats (downbeats for the big ones) and a reveal on the drop are ' +
    'what make an edit feel musical. Pass itemId for music on the timeline: beats come back in ' +
    'timeline frames, already mapped through the clip\'s position, in-point and speed, so they ' +
    'go straight into split_at, trim_item, place_asset or edit_item. Pass assetId for a whole ' +
    'file: seconds from its start. Pass markers to also get a ready list for add_marker (one ' +
    'call places them all, one undo step). Once a file is analysed, dragging and trimming clips ' +
    'in the timeline snaps to its beats. downbeats is empty when no beat of the bar is clearly ' +
    'accented — then count bars from a beat you choose rather than inventing one. Low confidence ' +
    '(under ~0.3) means the music has no steady beat; say so rather than cutting to it.',
  category: 'read',
  readOnly: true,
  timeoutMs: 5 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'Music on the timeline. ' + itemId.description },
      assetId: { type: 'string', description: 'An imported file, from browse_assets.' },
      beatsPerBar: {
        type: 'integer',
        minimum: 2,
        maximum: 12,
        description: 'Beats in a bar, for the downbeats. Default 4; 3 for a waltz.'
      },
      markers: {
        type: 'string',
        enum: ['downbeats', 'beats'],
        description:
          'With itemId: also return `markers`, ready for add_marker — every downbeat (labelled ' +
          '"Bar 1", "Bar 2" …) or every beat ("1.1", "1.2" …), plus one per drop-out.'
      }
    }
  }
}
