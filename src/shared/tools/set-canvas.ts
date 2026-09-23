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
        enum: ['vertical-1080', 'landscape-1080', 'square-1080', 'landscape-4k'],
        description: 'A named canvas. vertical-1080 is 1080×1920, for shorts, reels and TikTok.'
      },
      width: { type: 'integer', description: 'Instead of a preset: width in pixels (with height).' },
      height: { type: 'integer', description: 'Instead of a preset: height in pixels (with width).' },
      fit: {
        type: 'string',
        enum: ['auto', 'cover', 'contain'],
        description: 'How video and images are re-fitted. cover fills the frame and may crop; contain shows all of it.'
      }
    }
  }
}
