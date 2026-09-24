import type { ToolSpec } from './spec'

export const order = 135

export const tool: ToolSpec = {
  name: 'import_url',
  description:
    'Download one video from a web page (YouTube, Vimeo and the other sites yt-dlp supports) and ' +
    'import it into the media pool. Uses the user\'s own yt-dlp — if it is not installed the ' +
    'refusal says how (`brew install yt-dlp`); pass that on rather than guessing. Only http(s) ' +
    'addresses; one video, never a whole playlist; at most 1080p, merged into an .mp4; stopped past ' +
    '2 GB or 15 minutes. The file is kept in bay\'s own downloads folder. Only download what the user ' +
    'asked for and has the right to use. In bay\'s panel each download asks the user first. ' +
    'validateOnly: true checks the address and finds yt-dlp without downloading. Returns the asset, ' +
    'as import_media does; place it with place_asset.',
  category: 'write',
  readOnly: false,
  selfValidating: true,
  timeoutMs: 16 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The page address of the video, starting with https://.' }
    },
    required: ['url']
  }
}
