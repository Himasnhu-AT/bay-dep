/**
 * Whether a keystroke that matched a command may run it. Pure, so the rules are tested rather
 * than trusted; `useCommands` feeds it the live event and document.
 *
 * - A control that already used the key (`defaultPrevented`: a slider's arrow, a segmented
 *   control's arrow, a fade handle's nudge) owns it. ← on a focused Opacity slider once changed
 *   the value *and* stepped the playhead, so an animated property was keyed on the wrong frame.
 * - An open dialog owns the keyboard. Backspace on the Export dialog's Close button deleted the
 *   clip behind it. Only text editing inside the dialog's own fields (commands that run
 *   `whileTyping`) still gets through; the menu's native keys never reach the listener at all.
 */
export interface KeyGateInput {
  defaultPrevented: boolean
  modalOpen: boolean
  typing: boolean
  whileTyping: boolean
}

export function keyMayRun({ defaultPrevented, modalOpen, typing, whileTyping }: KeyGateInput): boolean {
  if (defaultPrevented) return false
  if (modalOpen && !(typing && whileTyping)) return false
  return true
}
