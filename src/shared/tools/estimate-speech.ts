import type { ToolSpec } from './spec'

export const order = 354

export const tool: ToolSpec = {
  name: 'estimate_speech',
  description:
    'Estimate how long a piece of text takes to say, before any voice is generated — to size a ' +
    'voiceover to a gap, a generated clip to its narration, or a script rewrite to fit N seconds. ' +
    'Free, instant and read-only. English and Spanish are counted in syllables (numbers, symbols ' +
    'and acronyms as they are read aloud); Chinese, Japanese, Korean, German, Russian and Turkish ' +
    'in characters with pauses at punctuation; other languages get a rough generic estimate. ' +
    'Returns seconds, a slow–fast range, frames at the timeline’s fps, and how it counted. It is ' +
    'an estimate: a generated file’s measured length (track_generation) is the authority.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The words to be spoken.' },
      language: {
        type: 'string',
        description: 'en, es, zh, ja, ko, de, ru or tr; any other code gets the generic estimate. Omit to detect.'
      },
      pace: {
        type: 'string',
        enum: ['slow', 'normal', 'fast'],
        description: 'Delivery pace. normal by default; fast suits brisk social cuts.'
      },
      speed: { type: 'number', description: 'A TTS speed multiplier the voice will use (1 = its own pace).' },
      targetSeconds: { type: 'number', description: 'Optional: the gap it must fit. The answer says whether it fits and by how much.' }
    },
    required: ['text']
  }
}
