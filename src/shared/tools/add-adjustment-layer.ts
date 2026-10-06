import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 167

export const tool: ToolSpec = {
  name: 'add_adjustment_layer',
  description:
    'Add an adjustment layer: a clip with no picture of its own whose colour grade, adjustments and ' +
    'masks apply to EVERYTHING drawn under it for as long as it lasts. Use it for one look across ' +
    'several clips or tracks (a grade over a whole sequence, a vignette, a blurred or darkened ' +
    'region behind a title), instead of repeating the same edit_item on every clip — and so the ' +
    'look can be changed or removed in one place. For a look on one clip, use edit_item on that ' +
    'clip instead.\n' +
    'It goes above everything unless you name a track: it changes the video tracks BELOW its own, ' +
    'and nothing above. The layer does nothing until it has a look — follow with ' +
    'edit_item({ itemId, grade }) and/or { adjustments } (see edit_item), and { masks } to limit ' +
    'it to part of the frame (mask fractions are of the whole frame here). Its opacity is how ' +
    'strongly the look is mixed in (0.5 is half), and fades and opacity keyframes ease it in and ' +
    'out. It always covers the whole frame: left, top, width, height, rotation, scale, crop and ' +
    'blendMode do nothing on it and edit_item refuses them. Move, trim, split and delete it like ' +
    'any clip. Returns the layer\'s itemId and how many clips are under it.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      from: frames('First frame of the layer. Default: the playhead.'),
      durationInFrames: {
        type: 'integer',
        minimum: 1,
        description: 'How many frames it lasts. Default: 5 seconds. To cover clips, use their from and endFrame from read_project.'
      },
      trackId: {
        type: 'string',
        description:
          'A video track to put it on, to change only the tracks below that one. It must be unlocked and free over ' +
          'those frames. Default: above everything (the top video track if free there, else a new track).'
      }
    },
    required: []
  }
}
