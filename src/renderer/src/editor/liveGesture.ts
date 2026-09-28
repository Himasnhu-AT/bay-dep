import type { Gesture } from '@/components'
import { useEditor } from '@/store/editor'

/**
 * The store's gesture bracket in the shape the controls kit takes (`Gesture`): a control handed
 * this commits every move of a drag live, and the whole drag is one undo step — the same
 * `beginGesture`/`endGesture` the on-canvas transform uses. Components reach no store, so the
 * panels pass it in.
 *
 * Give it only to fields whose commit is quiet and idempotent (a layout value, a level, a grade
 * number). A commit that can be refused with a message, or that reports a note (a move, a retime,
 * a trim), would say so once per pixel; those fields commit once, on release.
 */
export const LIVE: Gesture = {
  begin: () => useEditor.getState().beginGesture(),
  end: () => useEditor.getState().endGesture()
}
