import type { ToolSpec } from './spec'

export const order = 216

export const tool: ToolSpec = {
  name: 'switch_speakers',
  description:
    'Cut a multicam podcast or interview between camera angles by whoever is talking, from how ' +
    'loud each speaker\'s mic is (measured on this Mac, 50 ms at a time). Give one angle per ' +
    'speaker — the video clip that shows them and, if their mic is a separate clip, micItemId; ' +
    'without it the angle\'s own sound is their mic. Optionally a wideItemId showing everyone, used ' +
    'when two people talk at once. The angles must be stacked on different video tracks and already ' +
    'in sync (run sync_angles first if they are not). Each angle is razored where it goes on or off ' +
    'screen and the off pieces are disabled — nothing is deleted, the sound keeps playing, any ' +
    'piece can be switched back on with set_item_enabled, and the whole switch is one undo step. ' +
    'Sound embedded in an angle is detached first so disabling its picture does not silence it. ' +
    'Rules: a mic counts once it has been above its threshold for 0.35 s and until 0.45 s after; ' +
    'a mic dominanceDb (default 6) under the loudest is bleed; no shot is shorter than minShotSec ' +
    '(default 0.75; 1.5–2 feels calmer); each cut lands leadSec (default 0.1) before the decision, ' +
    'so a new speaker is on screen about 0.3 s after they start. Thresholds are set per mic from ' +
    'its own levels unless thresholdDb is given. It refuses when only one angle would ever be on ' +
    'screen, and says which mic never crossed its threshold. Try validateOnly: true first to read ' +
    'the cut list and each angle\'s screen time.',
  category: 'write',
  readOnly: false,
  // Its handler awaits main's measurement, which a store dry run cannot wait for; validateOnly
  // reaches the handler, which measures and plans and applies nothing (`mcp/speech.ts`).
  selfValidating: true,
  timeoutMs: 10 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      angles: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            videoItemId: { type: 'string', description: 'The video clip showing this speaker.' },
            micItemId: { type: 'string', description: 'Their own mic, when it is a separate clip. Default: the video clip\'s sound.' }
          },
          required: ['videoItemId']
        },
        description: 'One per speaker, each on its own video track.'
      },
      wideItemId: { type: 'string', description: 'A video clip showing everyone, for when two or more talk at once.' },
      thresholdDb: {
        type: 'number',
        minimum: -90,
        maximum: -5,
        description: 'One level (dBFS RMS) above which any mic counts as talking. Default: each mic\'s own, halfway between its room tone and its speech.'
      },
      dominanceDb: { type: 'number', minimum: 0, maximum: 40, description: 'How far the loudest mic must lead for the others to count as bleed. Default 6.' },
      minShotSec: { type: 'number', minimum: 0.2, maximum: 30, description: 'Shortest shot. Default 0.75.' },
      leadSec: { type: 'number', minimum: 0, maximum: 1, description: 'How far before the decision each cut lands. Default 0.1.' }
    },
    required: ['angles']
  }
}
