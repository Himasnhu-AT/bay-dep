import type { ToolSpec } from './spec'
import { itemId } from './fields'

export const order = 212

export const tool: ToolSpec = {
  name: 'remove_silences',
  description:
    'Find the pauses in speech with ffmpeg\'s silence detector (on this Mac) and cut them out, ' +
    'closing each gap on every unlocked track at once — the same sync-safe cut as remove_range, ' +
    'all of it one undo step. Reach for it to tighten a talking head, a podcast or a narrated ' +
    'screen recording. Pass itemId for one clip, trackId for every clip on a dialogue track, or ' +
    'itemIds for several mics of one conversation (then a moment is cut only when every mic that ' +
    'plays it is silent — one person pausing while the other talks is not a pause). Silences are ' +
    'measured in the clip\'s own audio and mapped through its position, in-point and speed. ' +
    'Defaults: thresholdDb -30 (quieter than this is silence), minSilenceSec 0.5 (shorter pauses ' +
    'are kept), keepPaddingSec 0.2 (a breath left at each side of every cut). Try validateOnly: ' +
    'true first to see the ranges and the time saved without cutting. If nothing qualifies it ' +
    'says what to loosen: a noisy room needs a higher threshold (-25), a fast talker a shorter ' +
    'minSilenceSec (0.3).',
  category: 'write',
  readOnly: false,
  // Its handler awaits main's measurement, which a store dry run cannot wait for; validateOnly
  // reaches the handler, which measures and plans and applies nothing (`mcp/speech.ts`).
  selfValidating: true,
  timeoutMs: 10 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'One clip whose silences to remove. ' + itemId.description },
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Several clips heard together (one mic per speaker): cut only where all are silent.'
      },
      trackId: { type: 'string', description: 'Every clip on this track (a dialogue track), from read_project.' },
      thresholdDb: {
        type: 'number',
        minimum: -80,
        maximum: -5,
        description: 'Level in dBFS below which audio counts as silence. Default -30.'
      },
      minSilenceSec: {
        type: 'number',
        minimum: 0.1,
        maximum: 30,
        description: 'Only pauses at least this long are cut. Default 0.5.'
      },
      keepPaddingSec: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        description: 'Silence kept at each side of every cut, so words are not clipped. Default 0.2.'
      }
    }
  }
}
