/**
 * "Open the comment composer" — asked by the Add Comment command (⌥M), answered by the timeline
 * toolbar's Comments button, which owns the popover. A comment needs words before it exists, so
 * the key opens a place to type rather than adding an empty note; this is the one wire between
 * the command and the component that can show that place.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** Ask the composer to open. Returns false when nothing is mounted to open it. */
export function requestCommentComposer(): boolean {
  for (const listener of listeners) listener()
  return listeners.size > 0
}

export function onCommentComposerRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
