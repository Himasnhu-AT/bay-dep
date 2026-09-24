import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 70

export const tool: ToolSpec = {
  name: 'preview_frame',
  description:
    'Render one frame of the timeline as it currently composites and return it as an image. ' +
    'This is the only way to see what the edit actually looks like; item positions and sizes ' +
    'do not tell you whether a clip is framed well, or whether an overlay covers a face. ' +
    'Use it to check your own work before reporting it done.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      frame: frames('Timeline frame to render. Defaults to the playhead.'),
      includeTimecode: {
        type: 'boolean',
        description:
          'Burn the timecode and frame number into the bottom-left corner of the image. ' +
          'Useful when comparing several frames side by side; leave it off when the corner ' +
          'itself is what you are checking. The timecode is in the result as text either way.'
      }
    }
  }
}
