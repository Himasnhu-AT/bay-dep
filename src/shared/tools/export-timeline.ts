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
          'Video encode quality. "good" (default) matches what x264 CRF 20 used to give; "best" ' +
          'matches CRF 16, for a master you deliver; "draft" is small, for a look. H.264 is Apple ' +
          'VideoToolbox, VP9 for webm. Audio is 256 kbps AAC at every quality.'
      },
      loudness: {
        description:
          'Master the audio to a loudness target, verified on the encoded file: a preset ' +
          '("streaming" −14 LUFS / −1 dBTP, "podcast" −16 / −1, "broadcast" −23 / −1), ' +
          'or { integratedLufs, truePeakDb }. A mastered export is remembered on the timeline: ' +
          'leave loudness out and the next export uses the same target (the result says ' +
          '"remembered from the last export"). "off" exports unmastered and forgets it. With ' +
          'nothing remembered, omitted means unmastered — the level the preview played. Linear ' +
          'gain plus a true-peak limiter, never a compressor. track_export reports the delivered ' +
          "file's loudness either way, and warns when an unmastered file is below −20 or above −9 LUFS."
      }
    },
    required: ['outputPath', 'format']
  }
}
