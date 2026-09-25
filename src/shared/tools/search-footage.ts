import type { ToolSpec } from './spec'

export const order = 38

export const tool: ToolSpec = {
  name: 'search_footage',
  description:
    'Find shots by what is in the picture: "a dog running on a beach", "close-up of hands on a ' +
    'keyboard", "wide aerial of a city at night". Searches the frames index_footage sampled from ' +
    'the project\'s video and image files, on this Mac. Returns the best matches, best first, each ' +
    'with its asset, the time in the file (seconds and µs) and — where the file is on the timeline ' +
    'and plays that moment — the timeline frame. Describe the shot concretely, as a caption of the ' +
    'picture would, not as a keyword. Or pass `similarTo` (an asset and a time in it) to find ' +
    'shots that look like that one. Scores are only comparable within one search: read the order ' +
    'and `separation` (how far the best stands above the median; near 0 means nothing really ' +
    'matched), never the absolute value — and look at a hit with frame_grid or preview_frame ' +
    'before cutting to it.',
  category: 'read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the shot shows, in words.' },
      similarTo: {
        type: 'object',
        description: 'Instead of query: find frames that look like this one.',
        properties: {
          assetId: { type: 'string', description: 'An indexed video or image, from browse_assets.' },
          seconds: { type: 'number', minimum: 0, description: 'The moment in that file, in seconds from its start. Default 0.' }
        },
        required: ['assetId']
      },
      assetIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search only these assets. Default: every video and image in the project.'
      },
      limit: { type: 'number', minimum: 1, maximum: 50, description: 'How many hits. Default 8.' }
    }
  }
}
