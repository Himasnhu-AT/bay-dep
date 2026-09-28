import type { ToolSpec } from './spec'

export const order = 166

/**
 * One tool for the whole recipe rather than `edit_item.masks` plus a duplicate plus a matte job,
 * because the three must agree: the copy must be the clip's exact moment (or it is drawn from a
 * second decoder and drifts), must sit above the title, and needs a matte for exactly the source
 * it plays. Done by hand, each of those is a way to get a cut-out that is a frame off.
 */
export const tool: ToolSpec = {
  name: 'put_behind_subject',
  description:
    'Put a title, text or graphic BEHIND the person in a clip — the words sit between the background ' +
    'and the speaker, the short-form "text behind me" look. bay finds the person in every frame the ' +
    'clip plays (Apple Vision, on this Mac; ~11 ms per frame the first time, cached after), then ' +
    'arranges, in one undo step: the clip; above it the title (moved up if it was under the clip); ' +
    'above that a linked, silent copy of the clip cut out to the person. The copy is drawn from the ' +
    'same decoded frame as the clip, so they cannot drift apart, and moves, trims and splits with it.\n' +
    'Make the title first (large — the effect reads only when the person covers part of the letters; ' +
    'aim for a third to a half of the letter height overlapped), place it over the clip, then call ' +
    'this. Afterwards look at a frame where the head crosses the words with preview_frame. Refused, ' +
    'with what to do instead, when the clip has no person in most frames, the two never overlap in ' +
    'time, a track is locked, or Apple Vision is not available on this Mac.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'put_behind_subject computes the subject matte in main (a file in the cache) before it arranges ' +
    'anything, and a dry run cannot put that back. To check the arrangement without it, read_project ' +
    'for the clip and title ids and their frames.',
  // A minute of 30 fps footage is ~1,800 frames at ~11 ms: ~20 s, plus the first start of Vision.
  timeoutMs: 10 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      textItemId: { type: 'string', description: 'The text item to put behind the person. Or pass itemId for any graphic.' },
      itemId: { type: 'string', description: 'The graphic (text, .brf, composition or image) to put behind the person, when it is not a text item.' },
      videoItemId: { type: 'string', description: 'The video clip with the person in it, playing at the same time as the title.' },
      feather: {
        type: 'number',
        minimum: 0,
        maximum: 200,
        description: 'Softening of the cut-out edge, in canvas pixels. Default 0 (Vision\'s own soft edge). 2–6 hides a hard edge on hair.'
      }
    },
    required: ['videoItemId']
  }
}
