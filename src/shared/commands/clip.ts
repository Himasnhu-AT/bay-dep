import { SEPARATOR, type CommandEntry } from './types'

/** Clip: acting on the selected clips (or, with none selected, what the playhead crosses). */
export const clipCommands = [
  // ⌘B is the shared NLE binding (FCP, Resolve, CapCut); S stays for existing hands.
  { id: 'clip.split', label: 'Split at Playhead', group: 'Clip', shortcut: ['Mod+B', 'S'] },
  { id: 'clip.splitAll', label: 'Split All Tracks', group: 'Clip', shortcut: 'Mod+Shift+B' },
  { id: 'clip.duplicate', label: 'Duplicate', group: 'Clip', shortcut: 'Mod+D' },
  SEPARATOR,
  // Q/W ripple, as in CapCut and Premiere: the trimmed-off frames close up behind the clip.
  // ⌥Q/⌥W trim the same edge and leave the gap.
  { id: 'clip.trimStartRipple', label: 'Ripple Trim Start to Playhead', group: 'Clip', shortcut: 'Q' },
  { id: 'clip.trimEndRipple', label: 'Ripple Trim End to Playhead', group: 'Clip', shortcut: 'W' },
  { id: 'clip.trimStart', label: 'Trim Start to Playhead', group: 'Clip', shortcut: 'Alt+Q' },
  { id: 'clip.trimEnd', label: 'Trim End to Playhead', group: 'Clip', shortcut: 'Alt+W' },
  SEPARATOR,
  { id: 'clip.nudgeLeft', label: 'Nudge Left One Frame', group: 'Clip', shortcut: 'Alt+ArrowLeft' },
  { id: 'clip.nudgeRight', label: 'Nudge Right One Frame', group: 'Clip', shortcut: 'Alt+ArrowRight' },
  {
    id: 'clip.nudgeLeftMany',
    label: 'Nudge Left 10 Frames',
    group: 'Clip',
    shortcut: 'Alt+Shift+ArrowLeft'
  },
  {
    id: 'clip.nudgeRightMany',
    label: 'Nudge Right 10 Frames',
    group: 'Clip',
    shortcut: 'Alt+Shift+ArrowRight'
  },
  SEPARATOR,
  { id: 'clip.toggleEnabled', label: 'Enable/Disable Clip', group: 'Clip', shortcut: 'Shift+E' },
  { id: 'clip.addTransition', label: 'Add Transition at Nearest Cut', group: 'Clip', shortcut: 'Mod+T' },
  SEPARATOR,
  // Shift is ripple, as in Premiere and Resolve: plain Delete lifts and leaves the gap.
  { id: 'clip.delete', label: 'Delete', group: 'Clip', shortcut: ['Delete', 'Backspace'] },
  {
    id: 'clip.rippleDelete',
    label: 'Ripple Delete',
    group: 'Clip',
    shortcut: ['Shift+Delete', 'Shift+Backspace']
  }
] as const satisfies readonly CommandEntry[]
