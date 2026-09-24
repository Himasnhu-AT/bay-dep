import { SEPARATOR, type CommandEntry } from './types'

/** Playback: the transport and the playhead. */
export const playbackCommands = [
  { id: 'playback.toggle', label: 'Play/Pause', group: 'Playback', shortcut: 'Space' },
  SEPARATOR,
  { id: 'playback.stepBack', label: 'Back One Frame', group: 'Playback', shortcut: 'ArrowLeft' },
  {
    id: 'playback.stepForward',
    label: 'Forward One Frame',
    group: 'Playback',
    shortcut: 'ArrowRight'
  },
  {
    id: 'playback.stepBackMany',
    label: 'Back 10 Frames',
    group: 'Playback',
    shortcut: 'Shift+ArrowLeft'
  },
  {
    id: 'playback.stepForwardMany',
    label: 'Forward 10 Frames',
    group: 'Playback',
    shortcut: 'Shift+ArrowRight'
  },
  SEPARATOR,
  { id: 'playback.toStart', label: 'Go to Start', group: 'Playback', shortcut: 'Home' },
  { id: 'playback.toEnd', label: 'Go to End', group: 'Playback', shortcut: 'End' }
] as const satisfies readonly CommandEntry[]
