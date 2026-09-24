import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 170

export const tool: ToolSpec = {
  name: 'trim_item',
  description:
    'Refine an edit without changing the program\'s length: slip, slide or roll one clip.\n' +
    '- slip: the clip stays exactly where it is and shows a different part of its source. ' +
    'Reach for it when the timing is right but the moment is wrong — "start the take half a ' +
    'second later".\n' +
    '- slide: the clip moves along its track with its content unchanged, and the clips either ' +
    'side absorb the move — the one before it lengthens or shortens at its out-point, the one ' +
    'after at its in-point — so nothing downstream shifts. Reach for it to move a shot earlier ' +
    'or later between two others. A gap on one side absorbs the move up to its size; a clip ' +
    'touching nothing on either side cannot slide (use edit_item "from").\n' +
    '- roll: the cut between two abutting clips moves; the outgoing clip ends later and the ' +
    'incoming starts later by the same amount (or both earlier). Reach for it to cut on the ' +
    'action rather than just before it.\n' +
    'All three spend footage beyond the clips\' visible range. When there is not enough, or a ' +
    'clip would shrink to nothing, the call is REFUSED — never clamped — and the refusal gives ' +
    'the legal deltaFrames range; pass deltaFrames 0 to ask for the range without changing ' +
    'anything. Transitions stay on their cuts (every cut that existed still exists); the ' +
    'result reports any whose length the new handles now shorten. One call is one undo step.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        ...itemId,
        description:
          'The clip to slip or slide, or for roll the clip on one side of the cut (see edge). ' +
          itemId.description
      },
      mode: { type: 'string', enum: ['slip', 'slide', 'roll'] },
      deltaFrames: {
        type: 'integer',
        description:
          'Signed frames. Positive slips to LATER source footage, slides the clip RIGHT, and ' +
          'rolls the cut LATER; negative is the opposite.'
      },
      linked: {
        type: 'boolean',
        description:
          'Default true: a clip linked to others (a picture and its detached sound — see ' +
          'detach_audio) is slipped, slid or rolled with them, so they stay in sync. false ' +
          'changes only this clip and leaves them out of step.'
      },
      edge: {
        type: 'string',
        enum: ['start', 'end'],
        description:
          'Roll only: which of itemId\'s cuts to move. "end" (default) is the cut with the ' +
          'clip that starts where it ends; "start" the cut with the clip that ends where it ' +
          'starts. Refused with slip or slide.'
      }
    },
    required: ['itemId', 'mode', 'deltaFrames']
  }
}
