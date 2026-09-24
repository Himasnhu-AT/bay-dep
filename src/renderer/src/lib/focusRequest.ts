/**
 * "Focus this when it is on screen" from anywhere — for an action that opens a panel whose
 * content is not mounted yet. Media › Add Subtitles… switches to the Text panel from a menu that
 * has just closed over a tile the switch unmounts, so focus fell to the page body and a keyboard
 * user had to find their way back in. The request waits here until the target mounts and takes
 * it, or, when the target is already mounted, reaches it through the event.
 *
 * No imports, so anything may use it.
 */
export const FOCUS_REQUEST_EVENT = 'bay:focus-request'

let pending: string | null = null

export function requestFocus(id: string): void {
  pending = id
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_REQUEST_EVENT, { detail: { id } }))
}

/** True once for a request aimed at `id` — the caller then moves focus — and false otherwise. */
export function takeFocusRequest(id: string): boolean {
  if (pending !== id) return false
  pending = null
  return true
}
