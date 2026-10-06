import type { ToolSpec } from './spec'

export const order = 270

export const tool: ToolSpec = {
  name: 'add_captions',
  description:
    'Put captions on the timeline: every cue becomes a text item on a NEW video track above ' +
    'all others, in one call and one undo step. Reach for it for subtitles, a transcript, or ' +
    'any run of timed lines — rather than placing text assets one at a time, which is dozens ' +
    'of calls and dozens of undo steps. Pass EITHER cues, timed in timeline frames, OR srt, ' +
    'the text of an SRT or WebVTT file (timed in wall clock; bay converts at this timeline\'s ' +
    'frame rate). Cues may not overlap, because they share one track: the whole call is ' +
    'refused naming the overlapping pair and the frame that would fix it, and nothing is ' +
    'placed. Lines that overlap by less than a frame round onto the same frame and are fine. ' +
    'Captions sit in the lower third on a translucent plate sized to the frame; pass style to ' +
    'change the look for all of them. The result lists the item ids in time order.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      cues: {
        type: 'array',
        items: { type: 'object' },
        description:
          '[{ fromFrame, toFrame, text }]. toFrame is the first frame the caption is NOT ' +
          'shown, so one cue ending where the next begins do not overlap. Any order.'
      },
      srt: {
        type: 'string',
        description:
          'An SRT or WebVTT document as text (WebVTT when it starts with WEBVTT). Accepts ' +
          '@./captions.srt to read it from a file, which is the better route for anything long. ' +
          'Markup such as <i> is stripped; bay draws one style per caption.'
      },
      offsetFrames: {
        type: 'integer',
        description:
          'Shift every cue by this many frames — for captions of a clip that starts partway ' +
          'into the timeline. Negative is allowed as long as no cue lands before frame 0.'
      },
      style: {
        type: 'object',
        description:
          'Overrides for the caption look, the same fields as edit_item "text" (fontSize, ' +
          'color, background, … and look, such as { look: "caption-bold" }), merged over the ' +
          'caption default. To restyle captions already placed, use apply_text_look with the track.'
      }
    }
  }
}
