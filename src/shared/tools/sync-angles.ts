import type { ToolSpec } from './spec'

export const order = 218

export const tool: ToolSpec = {
  name: 'sync_angles',
  description:
    'Line up several recordings of one event — camera angles, separate mics — by their sound, the ' +
    'way an editor syncs to a clap. Each clip\'s audio is reduced to a 10 ms level envelope on this ' +
    'Mac and cross-correlated against the first clip, which stays put; every other clip is moved so ' +
    'its sound lines up (its linked sound moves with it). Run it before switch_speakers on footage ' +
    'that was not recorded to a common clock. The result gives each clip\'s offset in seconds and ' +
    'frames and two confidence numbers: correlation (does the sound match, 0..1) and peakRatio ' +
    '(how clearly this offset beats every other — low on repetitive audio such as a music bed). ' +
    'When either is low for any clip nothing moves and it says which clip, so you can sync that ' +
    'one by hand or leave it out. A clip that would have to start before frame 0 shifts everything ' +
    'right instead. One undo step. Try validateOnly: true to read the offsets without moving.',
  category: 'write',
  readOnly: false,
  // Its handler awaits main's measurement, which a store dry run cannot wait for; validateOnly
  // reaches the handler, which measures and plans and applies nothing (`mcp/speech.ts`).
  selfValidating: true,
  timeoutMs: 10 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Clips of the same event, the reference first. Each on its own track.'
      }
    },
    required: ['itemIds']
  }
}
