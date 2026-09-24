import type { ToolSpec } from './spec'

export const order = 80

export const tool: ToolSpec = {
  name: 'read_script',
  description:
    'The active timeline as an editable script: markdown, one line per clip in timeline ' +
    'order, grouped by track — `- [id] in → out · source · src <seconds>s · "text"`, with ' +
    'transitions as `~ [id]` lines under the clip they leave. Reach for it when an edit ' +
    'touches many clips at once — tightening a cut, reordering shots, fixing every title — ' +
    'and hand the edited text to apply_script instead of making one call per clip. The ' +
    'header (timeline, rev, fps) must come back unchanged. Format: bay://guide/script.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} }
}
