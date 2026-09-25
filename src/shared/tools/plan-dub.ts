import type { ToolSpec } from './spec'
import { frames, itemId } from './fields'
import { DUB_CONTEXT_CUES, TEMPO_ACCEPT } from '../dub'

export const order = 356

export const tool: ToolSpec = {
  name: 'plan_dub',
  description:
    'Start a translated dub of a speech clip: the speech as cues (sentences, in timeline frames), ' +
    'each with its slot — the seconds its translated line may take, until the next cue starts — ' +
    'and a speech budget for the target language, plus the rules to translate by. Free and ' +
    'read-only; it transcribes on this Mac first when the clip has no transcript this session. ' +
    'You are the translator: translate every cue using the ' + DUB_CONTEXT_CUES + ' cues either side ' +
    'as context, check each line fits its slot (estimate_speech), rewrite over-long ones shorter, ' +
    'then pass { cueId, text } for each to apply_dub with the same itemId, language and range. ' +
    'bay speeds a line up to ' + TEMPO_ACCEPT + '× to fit. The `dub` skill walks the whole job.',
  category: 'read',
  readOnly: true,
  timeoutMs: 15 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'The speech clip to dub. ' + itemId.description },
      language: {
        type: 'string',
        description:
          'The language to dub into, as a code: en, es, zh, ja, ko, de, ru, tr are estimated closely; any other code ("fr", "hi", …) gets a rough estimate.'
      },
      sourceLanguage: {
        type: 'string',
        description: 'The language spoken in the clip, as a code or "auto", when a transcription is needed. Default "en".'
      },
      fromFrame: frames('Optional: dub only cues starting at or after this timeline frame.'),
      toFrame: frames('Optional: the first frame after the part to dub (half-open).'),
      pace: {
        type: 'string',
        enum: ['slow', 'normal', 'fast'],
        description: 'The delivery pace the budgets assume. normal by default; energetic delivery is fast, calm and storytelling are slow.'
      }
    },
    required: ['itemId', 'language']
  }
}
