import type { ToolSpec } from './spec'
import { TEXT_LOOKS } from '../text-style'

export const order = 165

export const tool: ToolSpec = {
  name: 'apply_text_look',
  description:
    'Restyle several titles at once, as one undo step: give every caption on a track — or every ' +
    'title on the timeline — one look. Use it instead of looping edit_item when a set of titles ' +
    'must match. Give either look (a named style) or fromItemId (copy the look of a title you ' +
    'have already styled, its font included), and say which titles: itemIds, trackId, or all: ' +
    'true. Each title keeps its own words, size, box, alignment and line height; outline and ' +
    'shadow sizes are scaled to its size. Clips that are not titles are skipped on a track or the ' +
    'timeline and refused by name in itemIds; titles on locked tracks are skipped and named. ' +
    'For one title, or to change one field of a look afterwards, use edit_item text. Looks: ' +
    TEXT_LOOKS.map((look) => `"${look.id}" — ${look.description}`).join(' '),
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      look: { type: 'string', enum: TEXT_LOOKS.map((look) => look.id), description: 'A named look. Give this or fromItemId, not both.' },
      fromItemId: {
        type: 'string',
        description: 'A title whose look to copy onto the others — its paint, weight, tracking and font. Give this or look.'
      },
      itemIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Exactly these titles.' },
      trackId: { type: 'string', description: 'Every title on this track — a caption track, usually.' },
      all: { type: 'boolean', description: 'true: every title on the timeline.' }
    }
  }
}
