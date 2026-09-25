import type { ToolSpec } from './spec'

export const order = 37

export const tool: ToolSpec = {
  name: 'index_footage',
  description:
    'Prepare the project\'s video and image files for search_footage: bay samples a frame every ' +
    'two seconds and embeds it with a local image/text model (SigLIP) on this Mac — nothing leaves ' +
    'it. Call it once before searching footage the first time; files already indexed (by content, ' +
    'in any project) are skipped, so calling it again only indexes what is new. It starts a ' +
    'background job and returns at once — before checking which files are new, and before the ' +
    'model download when that has to happen first (`downloading: true`; 409 MB, so minutes): call ' +
    'it again with no arguments to see progress, or `cancel: true` to stop. validateOnly reports ' +
    'how many files and frames it would index and roughly how long, and starts nothing; it reads ' +
    'part of every file, so on many files or a slow drive it can take a while. Needs the visual ' +
    'search model; when it is missing and the user has not allowed downloads, the answer says how ' +
    'the user gets it (Settings › Visual search).',
  category: 'read',
  readOnly: false,
  selfValidating: true,
  // What still happens before the answer: validateOnly's plan, which hashes 3 MiB of every file
  // (a thousand files on a slow external drive is the order of a minute). A real request answers
  // at once — the download and the check run in the job.
  timeoutMs: 3 * 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      assetIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only these assets (from browse_assets). Default: every video and image in the project.'
      },
      cancel: { type: 'boolean', description: 'Stop the indexing job that is running. Files already indexed stay indexed.' }
    }
  }
}
