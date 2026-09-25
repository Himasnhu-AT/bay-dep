import type { ToolSpec } from './spec'
import { frames, itemId } from './fields'

export const order = 32

export const tool: ToolSpec = {
  name: 'find_highlights',
  description:
    'Get what you need to pick short, stand-alone clips out of a long talk, podcast or interview: ' +
    'the speech as numbered sentences with their times and lengths, plus the scoring rubric ' +
    '(hook, information, emotion, completeness, 0–100), the rules every pick must keep and the ' +
    'target length. bay does not choose or score — you read the sentences and do that. Pass itemId ' +
    'for a clip on the timeline (sentences in timeline frames; add fromFrame/toFrame to look at ' +
    'part of it), or fromFrame/toFrame alone when one speech clip covers that range; pass assetId ' +
    'for a whole file (sentences in seconds). It transcribes on this Mac first when the clip has no ' +
    'transcript this session (the same cache transcribe uses). Then pass your picks to ' +
    'mark_highlights, which checks them (no overlaps, inside the material, within the length) and ' +
    'drops a pair of markers on each. The `highlights` skill walks the whole job.',
  category: 'read',
  readOnly: true,
  timeoutMs: 15 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { ...itemId, description: 'A speech clip on the timeline. ' + itemId.description },
      assetId: {
        type: 'string',
        description: 'An imported file, from browse_assets. Sentences come back in seconds from its start.'
      },
      fromFrame: frames('With itemId, or alone: the first timeline frame to consider.'),
      toFrame: frames('With itemId, or alone: the first frame after the part to consider (half-open).'),
      focus: {
        type: 'string',
        enum: ['balanced', 'viral', 'knowledge'],
        description:
          'What to favour when scoring. viral: opening pull and feeling. knowledge: complete, dense points. Default balanced.'
      },
      genre: {
        type: 'string',
        enum: ['auto', 'talk', 'podcast', 'tutorial', 'interview', 'entertainment', 'sports', 'gaming', 'news'],
        description: 'What kind of material it is, as a hint for scoring. Default auto.'
      },
      count: { type: 'integer', minimum: 1, maximum: 20, description: 'At most this many clips. Default 3.' },
      minSeconds: { type: 'number', minimum: 1, description: 'Shortest clip. Default 30.' },
      maxSeconds: { type: 'number', minimum: 1, description: 'Longest clip. Default 60.' },
      language: {
        type: 'string',
        description: 'Spoken language as a code ("en", "fr", …) or "auto", when a transcription is needed. Default "en".'
      }
    }
  }
}
