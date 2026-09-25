import type { ToolSpec } from './spec'
import { frames, itemId } from './fields'
import { SPEECH_STYLE_IDS } from '../speech'
import { DUB_DUCK_DB, TEMPO_ACCEPT, TEMPO_WARN } from '../dub'

export const order = 357

export const tool: ToolSpec = {
  name: 'apply_dub',
  description:
    'Voice your translated lines: one generated speech job per cue, then (through track_dub) each ' +
    'line placed at its cue on a "Dub (<language>)" audio track, with the original dialogue ducked ' +
    'or muted — one undo step. It COSTS the user money: call it with validateOnly: true first; that ' +
    'checks every line against its slot, returns the whole plan and the total estimated cost, and ' +
    'spends nothing — show the user the cost and get their go-ahead before the real call. Pass the ' +
    'same itemId, language and fromFrame/toFrame you gave plan_dub, and a translation for every cue ' +
    '(or partial: true to redo only some — those replace the lines already on the dub track). A line ' +
    'whose estimate needs more than ' + TEMPO_ACCEPT + '× speed is refused, every such line named with ' +
    'its overage and the characters to cut. The session budget in Settings › Providers is checked ' +
    'for the whole dub before any job starts, and jobs run a few at a time within its jobs-at-once ' +
    'limit. Returns a dubId at once: **call track_dub with it until it is placed, before your final ' +
    'answer**. After generation a line longer than its slot is sped up (pitch kept) up to ' +
    TEMPO_ACCEPT + '× quietly, up to ' + TEMPO_WARN + '× with a warning, and beyond that is not placed. ' +
    'If no key is set, tell the user to add one in Settings › Providers — never ask for a key in chat.',
  category: 'write',
  readOnly: false,
  selfValidating: true,
  timeoutMs: 15 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'The speech clip, as given to plan_dub. ' + itemId.description },
      language: { type: 'string', description: 'The target language code, as given to plan_dub.' },
      sourceLanguage: { type: 'string', description: 'As given to plan_dub.' },
      fromFrame: frames('As given to plan_dub.'),
      toFrame: frames('As given to plan_dub.'),
      planId: {
        type: 'string',
        description:
          'The planId plan_dub returned. Checked: if the clip no longer reads as that plan did (moved, retranscribed, another range), the call is refused with the current cues, so no translation is voiced over the wrong line.'
      },
      translations: {
        type: 'array',
        description:
          'One entry per cue: { cueId, text } — the cue ids plan_dub returned, and the spoken words in the target language.',
        items: {
          type: 'object',
          properties: {
            cueId: { type: 'string' },
            text: { type: 'string' }
          },
          required: ['cueId', 'text']
        }
      },
      partial: {
        type: 'boolean',
        description: 'Allow translations for only some cues (a redo of those lines). Otherwise every cue must be translated.'
      },
      model: { type: 'string', description: 'A speech model id, as generate_speech lists them.' },
      voice: { type: 'string', description: 'A voice the model offers. Omit for its default.' },
      style: { type: 'string', enum: SPEECH_STYLE_IDS, description: 'A delivery preset, on models that take one.' },
      instructions: { type: 'string', description: 'Custom delivery direction, on models that take it.' },
      speed: { type: 'number', description: 'TTS speed multiplier, on models that take one.' },
      original: {
        type: 'string',
        enum: ['duck', 'mute', 'keep'],
        description: `What happens to the original dialogue: duck (default, down ${DUB_DUCK_DB} dB while a dubbed line plays), mute, or keep.`
      },
      duckDb: {
        type: 'number',
        minimum: 1,
        maximum: 40,
        description: `With original: "duck", how far down in dB. Default ${DUB_DUCK_DB}.`
      }
    },
    required: ['itemId', 'language', 'translations', 'model']
  }
}
