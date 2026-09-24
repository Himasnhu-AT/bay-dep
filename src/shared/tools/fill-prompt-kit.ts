import type { ToolSpec } from './spec'
import { PROMPT_KITS } from '../prompt-kits'

export const order = 338

export const tool: ToolSpec = {
  name: 'fill_prompt_kit',
  description:
    'Turn a prompt kit — worked-out wording for a common shot, with the parts that change left as ' +
    'slots — into a finished request for generate_image or generate_video. Free: it calls no model ' +
    'and changes nothing. Returns `tool` and `request` (model, prompt, negativePrompt where the ' +
    'model takes one, aspectRatio, durationSeconds) to pass on, first with validateOnly: true. An ' +
    'unknown kit or slot, or a required slot left out, is refused with the valid ones. Every kit ' +
    'keeps on-screen text and logos out, because bay draws its own. bay://guide/prompt-kits lists ' +
    'each kit with its slots. Kits: ' +
    PROMPT_KITS.map((kit) => `${kit.id} (${kit.kind})`).join(', ') +
    '.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      kit: { type: 'string', description: 'Kit id, from the list in this description.' },
      slots: {
        type: 'object',
        description: 'Slot values as { slotId: "words" }. Leave out a slot to use its default; required ones have none.'
      },
      withReference: {
        type: 'boolean',
        description: 'You will pass a referenceAssetId. On a Kling model the request then leaves out aspectRatio, which the picture decides.'
      }
    },
    required: ['kit']
  }
}
