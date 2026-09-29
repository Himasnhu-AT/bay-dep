import type { ToolSpec } from './spec'
import { BUILT_IN_STYLES, STYLE_APPLIES_TO } from '../styles/index'

export const order = 97

export const tool: ToolSpec = {
  name: 'search_styles',
  description:
    'Find an editing style — a recognisable look and rhythm written as steps with bay\'s tools plus design tokens ' +
    '(palette, type, motion timings, eases, caption design). Reach for it when the user names a look ("like Hormozi", ' +
    '"a news package", "make it feel luxurious", "a launch film") or asks what styles there are, then read_style the ' +
    'best match and follow it. Free, local and read-only. Returns ranked { id, title, summary, tags, appliesTo, source } ' +
    'where source is "built-in" or "user" (saved with write_style). No query lists every style. Built-in: ' +
    BUILT_IN_STYLES.map((style) => style.id).join(', ') +
    '.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words describing the look, the format or the footage, such as "vertical talking head captions".' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Only styles carrying every one of these tags.' },
      appliesTo: {
        type: 'array',
        items: { type: 'string', enum: [...STYLE_APPLIES_TO] },
        description: 'Only styles with an opinion on every one of these parts of the edit.'
      }
    }
  }
}
