import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 360

export const tool: ToolSpec = {
  name: 'track_generation',
  description:
    'Status of a generate_image, generate_video or generate_speech job. While it runs: status and ' +
    'progress — poll again after 15–30 seconds, not in a tight loop. When it lands: the file is ' +
    'imported as an asset and returned (id, kind, duration), and with place: true it is also put ' +
    'on the timeline like place_asset — a voiceover on an audio track at atFrame, with its measured ' +
    'seconds beside the estimate. Always read `findings`: a blocking finding means the result was unusable and ' +
    'nothing was imported; a warning (a Veo clip with no sound, a different length than asked) ' +
    'must be reflected in your plan and your answer. A failed job says why and whether to retry. ' +
    'Call it again for a finished job and it returns the same asset rather than importing twice. ' +
    'Call with no jobId to list recent jobs.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'track_generation imports the finished file, which registers it with the app outside the ' +
    'project where a dry run cannot undo it. While the job is running it changes nothing, so ' +
    'call it without validateOnly.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'The jobId generate_image, generate_video or generate_speech returned. Omit to list recent jobs.' },
      place: { type: 'boolean', description: 'When the job is done, also place the asset on the timeline.' },
      atFrame: frames('With place: where it starts. Defaults to the playhead.'),
      trackId: { type: 'string', description: 'With place: the track. Omit to let bay choose a free one.' }
    }
  }
}
