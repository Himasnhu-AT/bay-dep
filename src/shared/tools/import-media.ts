import type { ToolSpec } from './spec'

export const order = 130

export const tool: ToolSpec = {
  name: 'import_media',
  description:
    'Import files from absolute paths into the media pool. Returns one asset per path, ' +
    'including any that could not be read — check `error` on each before placing it. ' +
    'Importing a path already in the project reuses the existing asset rather than ' +
    'duplicating it.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'import_media reads the files and registers them with the app so they can be played, ' +
    'and that registration lives outside the project where a dry run cannot undo it. ' +
    'Importing a path twice reuses the asset, so importing for real is safe to repeat.',
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths. Accepts @./file.json to read the array from a file.'
      }
    },
    required: ['paths']
  }
}
