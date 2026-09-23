import type { ToolSpec } from './spec'
import { frames } from './fields'

export const order = 280

export const tool: ToolSpec = {
  name: 'add_marker',
  description:
    'Put a named marker on the timeline at a frame — a note in time that read_project hands ' +
    'back on every later call. Reach for it to mark something you will act on later ("the ' +
    'laugh", "chapter 2", "check this cut"), to leave the user a point to review, or to record ' +
    'beats you found before editing to them. Markers belong to the program, not to a clip: ' +
    'they stay put when clips are moved or replaced, and move with time only when time itself ' +
    'is removed (remove_range) or the frame rate changes. To place many at once — the beats ' +
    'or bars detect_beats found — pass `markers` instead: one call, one undo step.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      frame: frames('Where the marker goes. Defaults to the playhead.'),
      label: {
        type: 'string',
        description: 'What it says. Omit it and bay numbers it ("Marker 3").'
      },
      color: { type: 'string', description: 'Hex, such as "#F5A524". Omit for the default.' },
      markers: {
        type: 'array',
        items: { type: 'object' },
        description:
          '[{ frame, label?, color? }] — several markers in one step, in place of frame/label/color. ' +
          'detect_beats returns this list ready to pass.'
      }
    }
  }
}
