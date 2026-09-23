import type { ToolSpec } from './spec'

export const order = 40

export const tool: ToolSpec = {
  name: 'read_project',
  description:
    'The project as it stands: name, canvas size and frame rate, every track, and every ' +
    'item with its id, position and duration in frames, and every marker. Start here. ' +
    'Everything else takes ids that come from this output, and the frame rate here is what ' +
    'every other time in this surface is measured in. ' +
    'Call it to **orient**, not to confirm — the write tools return the item they changed, ' +
    'and that answer is authoritative. Measured on a 200-clip timeline, a turn that re-reads ' +
    'after every edit spends 99% of its bytes re-reading a project it changed by 263 of them.',
  category: 'read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} }
}
