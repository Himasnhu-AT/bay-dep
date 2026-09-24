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

/**
 * Whether a command chosen from the native menu bar may run. The menu is outside the page, so an
 * open dialog's focus trap cannot stop a click there; this is the dialog's rule applied to it.
 *
 * - No dialog: everything runs — the menu is the other way to reach every command.
 * - A dialog is open: only `native` commands (Save, Open, Export…: file-level, never an edit to
 *   the timeline behind the dialog) and text editing in the dialog's own focused field (Undo,
 *   Cut, Copy, Paste, which run `whileTyping`). Clip › Split behind Project Settings would change
 *   the picture the dialog is being used to set up, with the result out of sight.
 *
 * Keys never get here for renderer-owned commands: main drops the key-equivalent clicks macOS
 * sends for keys the page declined (`menuClickRuns` in `main/menu.ts`), so this governs clicks.
 */
export interface MenuGateInput {
  modalOpen: boolean
  typing: boolean
  whileTyping: boolean
  native: boolean
}

export function menuCommandMayRun({ modalOpen, typing, whileTyping, native }: MenuGateInput): boolean {
  if (!modalOpen || native) return true
  return typing && whileTyping
}
