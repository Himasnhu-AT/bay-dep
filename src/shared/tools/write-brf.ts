import type { ToolSpec } from './spec'

export const order = 95

export const tool: ToolSpec = {
  name: 'write_brf',
  description:
    'Create motion graphics as a .brf: a JSX/TypeScript module, written the way you write React ' +
    'or Remotion, that bay runs in a sandbox and draws natively on its canvas — fast to scrub and ' +
    'export, no browser capture. Use it for titles, lower thirds, callouts, charts, counters, ' +
    'kinetic type and anything procedural; use write_composition only when you need a real web ' +
    'page (CSS layout, embedded media, a DOM library). Shape: `import { interpolate, spring } from ' +
    "'bay'` (or 'remotion' — useCurrentFrame, useVideoConfig, spring({frame,fps}), Sequence, " +
    'Easing, interpolateColors, random work); `export const vars = { title: "Hi" }` for what each ' +
    'placement may change; `export default ({ t, frame, fps, width, height, vars }) => <scene ' +
    'duration={4}>…</scene>` with t in SECONDS. Draw with <rect w h fill radius stroke>, <ellipse>, ' +
    '<path d draw>, <text size weight font fill align w split="word" stagger>{…}</text>, <glass w h ' +
    'radius material="regular"> (frosted glass over what is below it) and <group clip>; every element takes x, y (px or "50%"), anchor [ax,ay] (default centre), rotate, scale, ' +
    'sx, sy, opacity, blur, shadow, t=[start,end], and in/out presets ("up", "pop", "fade", "wipe", ' +
    '"type"…). Fills may be "linear(180, #000c, #0000)". Compute values from t in code, or use ' +
    'keys [[t,v,"outBack"]]. No DOM elements, no network, no imports but bay/remotion. Full ' +
    'reference and examples: bay://guide/brf. The code is compiled and run across its whole ' +
    'duration before anything changes; a compile or runtime error comes back with its line and ' +
    'frame. Check the look with preview_frame. Pass assetId to replace an existing .brf everywhere ' +
    'it is placed.',
  category: 'write',
  readOnly: false,
  dryRunRefusal:
    'write_brf runs the module in a worker to check it, which a dry run cannot wait for. It ' +
    'changes nothing until the code has run cleanly across its whole duration, and a write is one ' +
    'undo step, so write it and look with preview_frame instead.',
  timeoutMs: 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The module source (JSX/TSX). Accepts @./file.brf to read it from a file.'
      },
      name: { type: 'string', description: 'Name in the media pool. Default "Motion".' },
      assetId: {
        type: 'string',
        description:
          'Replace the source of this existing .brf asset instead of creating one; every placement ' +
          'of it changes. From browse_assets or a previous write_brf.'
      },
      atFrame: {
        type: 'integer',
        minimum: 0,
        description: 'Also place the new asset on the timeline at this frame. Omit to only create it.'
      },
      trackId: { type: 'string', description: 'With atFrame: the video track to place on. Default: one with room.' }
    },
    required: ['code']
  }
}
