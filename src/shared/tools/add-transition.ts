import type { ToolSpec } from './spec'

export const order = 230

export const tool: ToolSpec = {
  name: 'add_transition',
  description:
    'Put a transition across the cut between two clips that meet on one track. The two ' +
    'must abut — the first ending exactly where the second begins — because a transition ' +
    'is a property of a cut and there is no cut across a gap.\n' +
    'It straddles the cut without moving anything: the outgoing clip plays on for half the ' +
    'duration and the incoming starts the same amount early, both using footage outside ' +
    'the range they occupy. A clip with none to spare gets a shorter transition than you ' +
    'asked for, and the result says so — read `clampedBecause` rather than assuming you got ' +
    'the length you requested.\n' +
    'Adding a second transition to a junction that already has one replaces it.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      fromItemId: { type: 'string', description: 'The clip being left.' },
      toItemId: { type: 'string', description: 'The clip being entered.' },
      kind: {
        type: 'string',
        enum: [
          'cross-dissolve',
          'dip-to-black',
          'dip-to-white',
          'wipe',
          'push',
          'slide',
          'iris'
        ],
        description:
          'cross-dissolve for ordinary continuity; dip-to-black for a scene break; wipe, ' +
          'push and slide for movement; iris for emphasis. When unsure, cross-dissolve is ' +
          'what an editor reaches for by default.'
      },
      durationInFrames: {
        type: 'integer',
        minimum: 2,
        description:
          'Total across the cut, half each side. Around a second reads as a dissolve; ' +
          'much longer reads as a statement.\n' +
          '**Omit it** and bay picks about a second, or the most this junction can take if ' +
          'that is less. There is no way to ask how long a transition *could* be here ' +
          'without creating one, so the result always reports `maxDurationInFrames` — read ' +
          'that rather than guessing and retrying.'
      },
      direction: {
        type: 'string',
        enum: ['left', 'right', 'up', 'down'],
        description: 'For wipe, push and slide. Ignored by the others.'
      },
      ease: {
        description:
          'How the transition travels across its window, as a keyframe ease: "linear" (the ' +
          'default), "in", "out", "inOut", "hold", or a CSS cubic-bezier [x1, y1, x2, y2] with all ' +
          'four in 0..1 (a transition cannot overshoot its ends; y outside 0..1 is refused). It ' +
          'shapes the picture and the audio cross-fade alike. ' +
          'A push with "inOut" eases off the cut instead of sliding at one speed.'
      }
    },
    required: ['fromItemId', 'toItemId', 'kind']
  }
}
