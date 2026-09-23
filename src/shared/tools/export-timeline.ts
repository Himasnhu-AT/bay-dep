import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 320

export const tool: ToolSpec = {
  name: 'export_timeline',
  description:
    'Render the timeline to a file. Returns a job id immediately — encoding a long timeline ' +
    'takes minutes, so poll track_export rather than waiting. Check the result before ' +
    'telling the user it is done: an export can finish with no frames if the timeline is ' +
    'empty over the range you asked for.',
  category: 'submit',
  readOnly: false,
  dryRunRefusal:
    'export_timeline starts an encode that writes a file, which a dry run cannot take ' +
    'back. Check the range with preview_frame at its first and last frames instead.',
  inputSchema: {
    type: 'object',
    properties: {
      outputPath: { type: 'string', description: 'Absolute path, with extension.' },
      format: { type: 'string', enum: ['mp4', 'mov', 'webm', 'wav', 'mp3'] },
      fromFrame: frames('First frame. Defaults to 0.'),
      toFrame: frames('Last frame, inclusive. Defaults to the end of the timeline.'),
      quality: {
        type: 'string',
        enum: ['draft', 'good', 'best'],
        description:
          'Encode quality. "good" (default) is H.264 CRF 20 with 192 kbps AAC; "best" is CRF 16 ' +
          'with 256 kbps AAC, for a master you deliver; "draft" is fast and small, for a look.'
      },
      loudness: {
        description:
          'Master the audio to a loudness target, verified on the encoded file: a preset ' +
          '("streaming" −14 LUFS / −1 dBTP, "podcast" −16 / −1, "broadcast" −23 / −1), "off", ' +
          'or { integratedLufs, truePeakDb }. Off by default, so the file plays at the level ' +
          'the preview did. Linear gain plus a true-peak limiter, never a compressor; ' +
          'track_export reports what the delivered file measures.'
      }
    },
    required: ['outputPath', 'format']
  }
}
