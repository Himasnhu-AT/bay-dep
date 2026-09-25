import type { ToolSpec } from './spec'
import { describeModels } from '../generation'

export const order = 340

export const tool: ToolSpec = {
  name: 'generate_image',
  description:
    'Generate a still picture with an AI image model, on the provider named by the model, using ' +
    'the key the user set in Preferences › AI providers. It costs the user money: run it with ' +
    'validateOnly: true first to check the options and see the estimated cost, and generate only ' +
    'what the edit needs. Returns a jobId at once; the picture is not in the project yet. ' +
    '**Call track_generation with that jobId before your final answer** — it imports the picture ' +
    'as an asset when it lands (and places it, if asked). Pass referenceAssetId (an image asset) ' +
    'to edit or restyle an existing picture. An option the model does not take is refused with ' +
    'the values it does; nothing is narrowed silently. If no key is set, tell the user to add ' +
    'one in Preferences › AI providers — never ask for a key in chat. Models: ' +
    describeModels('image') + ' For a common shot, fill_prompt_kit writes a tested prompt (bay://guide/prompt-kits).',
  category: 'write',
  readOnly: false,
  selfValidating: true,
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Model id, from the list in this description.' },
      prompt: { type: 'string', description: 'What to draw. Be concrete about subject, framing, light and style.' },
      provider: { type: 'string', description: 'Optional; the model already names it.' },
      aspectRatio: { type: 'string', description: 'Gemini models, e.g. "16:9". Match the timeline where the picture will be placed.' },
      size: { type: 'string', description: 'OpenAI: "1024x1024" | "1536x1024" | "1024x1536". Gemini 3 Pro: "1K" | "2K" | "4K".' },
      quality: { type: 'string', description: 'OpenAI: "low" | "medium" | "high". Cost rises steeply with it.' },
      referenceAssetId: { type: 'string', description: 'Optional image asset (PNG, JPEG, WebP) to edit or restyle. It is sent to the provider.' }
    },
    required: ['model', 'prompt']
  }
}
