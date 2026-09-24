import { SEPARATOR, type CommandEntry } from './types'

/** Playback: the transport and the playhead. */
export const playbackCommands = [
  { id: 'playback.toggle', label: 'Play/Pause', group: 'Playback', shortcut: 'Space' },
  // JKL. L plays forwards, and again for 2×, 4× and 8×. J does the same backwards. K stops.
  // Hold K and tap J or L to step one frame.
  { id: 'playback.shuttleReverse', label: 'Play Backwards', group: 'Playback', shortcut: 'J' },
  { id: 'playback.shuttleStop', label: 'Stop', group: 'Playback', shortcut: 'K' },
  { id: 'playback.shuttleForward', label: 'Play Forwards', group: 'Playback', shortcut: 'L' },
  { id: 'playback.toggleLoop', label: 'Toggle Loop Playback', group: 'Playback', shortcut: 'Mod+L' },
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
  { id: 'playback.prevEdit', label: 'Previous Edit', group: 'Playback', shortcut: 'ArrowUp' },
  { id: 'playback.nextEdit', label: 'Next Edit', group: 'Playback', shortcut: 'ArrowDown' },
  {
    id: 'playback.prevMarker',
    label: 'Previous Marker',
    group: 'Playback',
    shortcut: 'Shift+ArrowUp'
  },
  {
    id: 'playback.nextMarker',
    label: 'Next Marker',
    group: 'Playback',
    shortcut: 'Shift+ArrowDown'
  },
  SEPARATOR,
  { id: 'playback.toStart', label: 'Go to Start', group: 'Playback', shortcut: 'Home' },
  { id: 'playback.toEnd', label: 'Go to End', group: 'Playback', shortcut: 'End' }
] as const satisfies readonly CommandEntry[]
