import type { ToolSpec } from './spec'

export const order = 219

export const tool: ToolSpec = {
  name: 'level_voices',
  description:
    'Balance speakers: measure each clip\'s loudness (EBU R128 integrated LUFS, over exactly what ' +
    'the clip plays, on this Mac) and set each clip\'s gain so every voice lands on the same level. ' +
    'Pass the clips that carry each speaker — one mic clip per person on a podcast, or several ' +
    'takes of one narrator. targetLufs defaults to -16, the spoken-word level Apple Podcasts asks ' +
    'for. It is clip gain (volume), not processing: dynamics are untouched and undo restores the ' +
    'old levels in one step. The result lists each clip before and after; a clip that needed more ' +
    'than the +6 dB clip gain allows is reported with the shortfall (raise its track fader, or pick ' +
    'a lower target). Clips with volume keyframes are refused by name, since their level is the ' +
    'keys\'. Silent clips are skipped and named.',
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
        minItems: 1,
        description: 'Clips carrying speech, from read_project.'
      },
      targetLufs: { type: 'number', minimum: -40, maximum: -5, description: 'Loudness to land every clip on. Default -16.' }
    },
    required: ['itemIds']
  }
}
