import type { ToolSpec } from './spec'

export const order = 152

export const tool: ToolSpec = {
  name: 'organize_assets',
  description:
    'File the media pool into bins (folders), the way a person keeps interviews, b-roll and ' +
    'music apart. One thing per call: put assets in a bin (`assetIds` with `bin` — a bin id or a ' +
    'name; a name no bin has yet makes that bin), take assets out of any bin (`assetIds` with ' +
    '`toTopOfPool: true`), make an empty bin (`bin` alone), rename one (`renameBin`), or remove one ' +
    '(`removeBin` — the media in it is kept and goes back to the top of the pool). A bin is ' +
    'only where an asset is listed: nothing on the timeline changes, and no file moves on disk. ' +
    'Reach for it when the pool is long enough that the user will have to look for things, or ' +
    'when they ask for it; browse_assets shows the result.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      assetIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Assets to file, from browse_assets.' },
      bin: {
        type: 'string',
        description: 'A bin id or name. With assetIds: where they go. Alone: make an empty bin of that name.'
      },
      toTopOfPool: {
        type: 'boolean',
        description: 'With assetIds, instead of bin: true takes them out of whatever bin they are in.'
      },
      renameBin: {
        type: 'object',
        properties: { bin: { type: 'string', description: 'The bin’s id or current name.' }, name: { type: 'string' } },
        required: ['bin', 'name']
      },
      removeBin: { type: 'string', description: 'The id or name of the bin to remove. Its media is kept.' }
    }
  }
}
