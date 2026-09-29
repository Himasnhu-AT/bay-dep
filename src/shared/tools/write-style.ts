import type { ToolSpec } from './spec'
import { STYLE_APPLIES_TO, STYLE_BASES, STYLE_LIMITS } from '../styles/index'

export const order = 99

export const tool: ToolSpec = {
  name: 'write_style',
  description:
    'Save an editing style for this user, so search_styles and read_style find it later (source "user"). Use it at the ' +
    'end of analysing a reference video (the style-from-reference skill), or when the user asks to keep a look you ' +
    'built. It writes a JSON file in bay\'s own styles folder and changes nothing in the project; nothing in it is ever ' +
    'run. The id is a slug and may not be a built-in style\'s (pick another and pass basedOn). Saving over one of the ' +
    'user\'s own styles needs replace: true. Angle brackets and control characters in the text are replaced, and every ' +
    `field has a cap (body ${STYLE_LIMITS.body} characters, summary ${STYLE_LIMITS.summary}, ${STYLE_LIMITS.tags} tags). ` +
    'A refusal lists every fault at once. validateOnly: true checks and returns the cleaned style without saving. ' +
    'Write the body as numbered steps that name only bay\'s tools; in params.timing give each number a basis — ' +
    `${STYLE_BASES.join(', ')} — where observed means you computed it from tool output on the reference.`,
  category: 'write',
  readOnly: false,
  selfValidating: true,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Slug: lowercase letters, digits and single hyphens, such as "warm-podcast-clip".' },
      title: { type: 'string', description: `At most ${STYLE_LIMITS.title} characters.` },
      summary: { type: 'string', description: 'One or two sentences: what it looks like and when to use it.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase words joined by hyphens, such as "talking-head", "vertical".' },
      formats: { type: 'array', items: { type: 'string' }, description: 'set_canvas preset ids it is made for, such as "vertical-1080".' },
      appliesTo: { type: 'array', items: { type: 'string', enum: [...STYLE_APPLIES_TO] } },
      footage: { type: 'string', description: 'What raw footage suits it, and what it cannot rescue.' },
      body: { type: 'string', description: 'Numbered imperative steps naming bay\'s tools and their parameters.' },
      params: {
        type: 'object',
        description:
          'Design tokens: { canvas?, palette?: [{ name, hex, role? }], type?: [{ role, family?, weight?, sizePx?, trackingEm?, case? }], ' +
          'motion?: [{ name, frames?, seconds?, ease?, spring?: { stiffness, damping }, note? }], eases?: { name: ease }, ' +
          'captions?: { design, accent?, scale?, bottom?, words? }, timing?: { name: { value: [low, high], unit, basis, source?, note? } }, ' +
          'audio?: { musicDb?, loudness?, note? }, grade?: { edit_item grade fields } }. An ease is linear, hold, in, out, inOut or [x1, y1, x2, y2].'
      },
      sources: { type: 'array', items: { type: 'object' }, description: 'Optional [{ id, label, url }] with https:// addresses, cited in the body as [id].' },
      basedOn: { type: 'string', description: 'The id of the style this one was derived from, if any.' },
      replace: { type: 'boolean', description: 'Save over the user style with this id. Default false.' }
    },
    required: ['id', 'title', 'summary', 'tags', 'body']
  }
}
