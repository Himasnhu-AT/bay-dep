import type { ToolSpec } from './spec'
import { describeModels } from '../generation'

export const order = 350

export const tool: ToolSpec = {
  name: 'generate_video',
  description:
    'Generate a short video clip with an AI video model (Veo on Gemini, or Kling), using the key ' +
    'the user set in Preferences › AI providers. It costs the user real money, priced per second: run ' +
    'it with validateOnly: true first to check the options and see the estimated cost. Returns a ' +
    'jobId at once; a clip takes minutes. **Call track_generation with that jobId and ' +
    'waitSeconds: 120 (again the same way while it runs), before your final answer** — it imports the clip as an asset when it lands ' +
    '(and places it, if asked). Pass referenceAssetId (an image asset) to animate a picture from ' +
    'that first frame. An option the model does not take is refused with the values it does; ' +
    'nothing is narrowed silently. If no key is set, tell the user to add one in Preferences › ' +
    'Providers — never ask for a key in chat. Models: ' +
    describeModels('video') + ' For a common shot, fill_prompt_kit writes a tested prompt (bay://guide/prompt-kits).',
  category: 'write',
  readOnly: false,
  selfValidating: true,
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Model id, from the list in this description.' },
      prompt: { type: 'string', description: 'The shot: subject, action, camera move, light, style — and for Veo, any sound.' },
      provider: { type: 'string', description: 'Optional; the model already names it.' },
      negativePrompt: { type: 'string', description: 'What to keep out of the shot.' },
      aspectRatio: { type: 'string', description: 'e.g. "16:9" or "9:16". Match the timeline. Kling takes it from the reference when one is given.' },
      durationSeconds: { type: 'integer', minimum: 1, description: 'Veo: 4, 6 or 8. Kling: 5 or 10.' },
      resolution: { type: 'string', description: 'Veo: "720p" | "1080p" | "4k" (1080p and 4k are 8 seconds only).' },
      mode: { type: 'string', description: 'Kling: "std" | "pro".' },
      referenceAssetId: { type: 'string', description: 'Optional image asset used as the first frame. It is sent to the provider.' }
    },
    required: ['model', 'prompt']
  }
}
