import type { ToolSpec } from './spec'
import { frames } from './fields'
import { TEMPLATES } from '../templates'

export const order = 110

export const tool: ToolSpec = {
  name: 'add_template',
  description:
    `Place one of bay's shipped templates — ${TEMPLATES.map((t) => t.id).join(', ')} — at ` +
    "the playhead in one call, sized to this timeline's canvas. " +
    'Reach for this before write_composition whenever a template fits: it writes the file, ' +
    'imports it and places it as ONE undo step, and it sizes the composition to the ' +
    'timeline so a template authored for a vertical frame fills a landscape one instead of ' +
    'landing as a narrow strip. resources/list shows each template (bay://template/<id>) ' +
    'with the variables it declares; pass values for them here, or set them later with ' +
    'edit_item({ variables }). Returns the placed item and the values it renders with.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'add_template writes the template file to disk before it places anything, and a file ' +
    'on disk is outside what a dry run can put back. Its variables are checked before ' +
    'anything is written, so a bad value is refused by the real call with nothing changed.',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        // Derived, so a template added to the catalog is placeable without a second edit here.
        enum: TEMPLATES.map((t) => t.id),
        description: 'Which template.'
      },
      variables: {
        type: 'object',
        description:
          'Optional values for the variables the template declares, as { id: value }. Any ' +
          'left out render with the template\'s default.'
      },
      atFrame: frames('Where it starts. Defaults to the playhead.')
    },
    required: ['templateId']
  }
}
