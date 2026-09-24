import type { ToolSpec } from './spec'
import { SPEECH_STYLE_IDS, describeSpeechModels } from '../speech'

export const order = 352

export const tool: ToolSpec = {
  name: 'generate_speech',
  description:
    'Generate a voiceover — the exact words given, spoken by an AI voice — on the provider named ' +
    'by the model, using the key the user set in Settings › Providers. It costs the user money: ' +
    'run it with validateOnly: true first to check the options and see the estimated cost and ' +
    'spoken length (the same estimate estimate_speech gives), and fit the script to the gap before ' +
    'paying for it. Returns a jobId at once; the audio is not in the project yet. **Call ' +
    'track_generation with that jobId before your final answer** — it imports the audio as an ' +
    'asset when it lands, and with place: true puts it on an audio track at atFrame. Its measured ' +
    'length is the authority; plan the edit around it, not the estimate. Style presets (' +
    SPEECH_STYLE_IDS.join(', ') +
    ') and custom instructions shape the delivery on models that take them; an option a model ' +
    'does not take is refused with what it does. If no key is set, tell the user to add one in ' +
    'Settings › Providers — never ask for a key in chat. Models: ' +
    describeSpeechModels(),
  category: 'write',
  readOnly: false,
  selfValidating: true,
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Model id, from the list in this description.' },
      text: {
        type: 'string',
        description: 'The words to speak, exactly as they should be heard. Spell out anything a reader might say differently.'
      },
      provider: { type: 'string', description: 'Optional; the model already names it.' },
      voice: { type: 'string', description: 'A voice the model offers (see the list). Omit for its default.' },
      style: { type: 'string', enum: SPEECH_STYLE_IDS, description: 'A delivery preset. Defaults to natural on models that take one.' },
      instructions: {
        type: 'string',
        description: 'Custom delivery direction, sent after the preset: tone, accent, emphasis, pace ("slowly, with a smile").'
      },
      speed: { type: 'number', description: 'Speed multiplier, on models that take one (see the list). 1 is the voice’s own pace.' },
      language: {
        type: 'string',
        description: 'Language code for the length estimate (en, es, zh, ja, ko, de, ru, tr). Detected when omitted.'
      }
    },
    required: ['model', 'text']
  }
}
