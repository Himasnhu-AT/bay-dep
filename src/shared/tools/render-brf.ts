import type { ToolSpec } from './spec'
import { WAIT_TOOL_TIMEOUT_MS } from './fields'

export const order = 97

export const tool: ToolSpec = {
  name: 'render_brf',
  description:
    'Render one .brf motion graphic alone to a video file with transparency: a ProRes 4444 .mov ' +
    'whose alpha channel is the graphic over nothing, so another editor (DaVinci Resolve, ' +
    'Premiere, Final Cut) can lay it over footage. This is how a graphic made with write_brf gets ' +
    'into a project that is edited in Resolve: render it, then import outputPath there and put it ' +
    'on a track above the clip. Waits for the render and returns outputPath, `complete` and ' +
    '`incompleteFrames` like export_timeline; check `complete` before using the file. The open ' +
    'project is not changed. Re-render after write_brf changes the graphic — the file does not follow.',
  category: 'submit',
  readOnly: false,
  timeoutMs: WAIT_TOOL_TIMEOUT_MS,
  dryRunRefusal:
    'render_brf writes a file, which a dry run cannot take back. write_brf has already run the ' +
    'graphic across its whole duration; look at it with preview_frame instead.',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', description: 'A .brf asset, from write_brf or browse_assets.' },
      outputPath: {
        type: 'string',
        description:
          'Absolute path ending in .mov. Omitted: "<project name> renders/<asset name>.mov" beside the saved project file.'
      },
      width: { type: 'number', description: 'Defaults to the size the scene declares, else the open timeline’s.' },
      height: { type: 'number', description: 'Defaults to the size the scene declares, else the open timeline’s.' },
      fps: {
        type: 'number',
        description:
          'Defaults to the open timeline’s. For a Resolve project pass the Resolve timeline’s frame rate, so the graphic lands frame for frame.'
      },
      wait: { type: 'boolean', description: 'Default true. false returns the jobId at once; track_export follows it.' }
    },
    required: ['assetId']
  }
}
