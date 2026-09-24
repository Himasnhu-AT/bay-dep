import { CANVAS_PRESETS } from '../project'
import type { ToolSpec } from './spec'

export const order = 260

export const tool: ToolSpec = {
  name: 'set_canvas',
  description:
    'Change the timeline\'s canvas — to vertical 1080×1920 for shorts and reels, square, ' +
    'landscape — and re-fit what was laid out for the old one: video and images by `fit` (auto ' +
    'covers the frame unless that would cut away too much, then fits inside), compositions to ' +
    'the full frame, text kept in the same place in proportion. One undo step. Templates ' +
    'already placed keep the size they were written for; add them again after a change of shape.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      preset: {
        type: 'string',
        // From the same list Project Settings offers, so the two cannot name different canvases.
        enum: CANVAS_PRESETS.map((preset) => preset.id),
        description:
          'A named canvas: ' +
          CANVAS_PRESETS.map((preset) => `${preset.id} (${preset.width}×${preset.height})`).join(', ') +
          '. vertical-1080 is for shorts, reels and TikTok.'
      },
      width: { type: 'integer', description: 'Instead of a preset: width in pixels (with height). Even, 16 to 8192.' },
      height: { type: 'integer', description: 'Instead of a preset: height in pixels (with width). Even, 16 to 8192.' },
      fit: {
        type: 'string',
        enum: ['auto', 'cover', 'contain'],
        description: 'How video and images are re-fitted. cover fills the frame and may crop; contain shows all of it.'
      }
    }
  }
}
