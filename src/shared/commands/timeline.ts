import type { CommandEntry } from './types'

/** Timeline: the view of the timeline — zoom now; snapping and fit belong here too. */
export const timelineCommands = [
  { id: 'timeline.zoomIn', label: 'Zoom In', group: 'Timeline', shortcut: ['+', '='] },
  { id: 'timeline.zoomOut', label: 'Zoom Out', group: 'Timeline', shortcut: ['-', '_'] }
] as const satisfies readonly CommandEntry[]
