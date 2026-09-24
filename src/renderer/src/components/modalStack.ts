/**
 * Which open dialog is on top, for the one rule that needs to know across dialogs: **a key
 * belongs to the topmost dialog only.** Every `Modal` listens on the window (a native `<select>`
 * popup takes focus out of its panel), so with Project Settings opened from Export, one Escape
 * reached both listeners and closed both dialogs; `stopPropagation` does not stop a sibling
 * listener on the same target. Tab trapping had the same fight.
 *
 * The order is the order dialogs opened, not the order their listeners were registered: a
 * listener re-registers whenever its `onClose` changes identity, which can put the lower
 * dialog's listener after the upper one's.
 *
 * Plain module state, like `floatingStack`: two dialogs share no React tree (both portal).
 */

const stack: symbol[] = []

/** Marks a dialog open, on top; call the returned function when it closes. Releasing twice is harmless. */
export function openModal(): { token: symbol; release: () => void } {
  const token = Symbol('modal')
  stack.push(token)
  return {
    token,
    release: () => {
      const at = stack.indexOf(token)
      if (at >= 0) stack.splice(at, 1)
    }
  }
}

/** Whether this dialog is the one keys go to. */
export function isTopModal(token: symbol | null): boolean {
  return token !== null && stack[stack.length - 1] === token
}

const handled = new WeakSet<Event>()

/**
 * Marks a key event as taken by a dialog, and says whether one already had. Needed beside the
 * stack: closing the top dialog can commit (and release its place) between two window listeners
 * of the same event, and the dialog under it would then find itself on top and close as well.
 */
export function takeKey(event: Event): boolean {
  if (handled.has(event)) return false
  handled.add(event)
  return true
}
