import type { ToolSpec } from './spec'

export const order = 250

export const tool: ToolSpec = {
  name: 'add_subtitles',
  description:
    'Word-by-word subtitles for a clip, in one of bay\'s designs: the speech is transcribed on ' +
    'this Mac (words and their times), grouped into short phrases, and drawn with the spoken ' +
    'word marked — the short-form look, which add_captions (one plain line per cue) cannot ' +
    'make. One composition covers the clip on a "Subtitles" track above everything; calling ' +
    'again for the same clip with another style REPLACES the earlier subtitles, so trying ' +
    'designs never stacks them. Styles: spotlight (bold white, the spoken word sky blue — the ' +
    'default), punch (outlined uppercase, one or two words, yellow pop), boxed (dark card, ' +
    'coloured chip on the spoken word), clean (whole phrases, no highlight — interviews), ' +
    'reveal (words appear as spoken, newest underlined). Ask the user which they want when ' +
    'they have not said. The first run may download a speech model if Settings allows it.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'it transcribes the clip and writes the subtitle composition to disk, so a dry run would do ' +
    'the expensive half of the work; call it for real and undo if needed.',
  timeoutMs: 15 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'The clip whose speech to subtitle (read_project lists items).' },
      style: {
        type: 'string',
        enum: ['spotlight', 'punch', 'boxed', 'clean', 'reveal'],
        description: 'The design. Defaults to spotlight.'
      },
      accent: { type: 'string', description: 'A hex colour for the highlight, instead of the design\'s own.' },
      scale: { type: 'number', description: 'Text size, as a multiple of the design\'s: 0.5 to 2.' },
      bottom: { type: 'number', description: 'Distance of the text from the bottom of the frame, in percent (0-90).' },
      language: { type: 'string', description: 'The spoken language, as a code such as en or fr. Defaults to en.' }
    },
    required: ['itemId']
  }
}
