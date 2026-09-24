import { useEditor } from '@/store/editor'

/**
 * Select a clip and bring it into view on the timeline — what a panel does after placing
 * something, so "added" is a clip the user can see rather than a toast about a track that may be
 * scrolled out of sight. The timeline already follows the playhead horizontally; this covers the
 * vertical case (a new track below the fold) and a placement away from the playhead.
 *
 * Found by the selected clip's `aria-selected`, after the next paint, because the clip element
 * does not exist until React has drawn the edit that created it.
 */
export function revealItem(itemId: string): void {
  useEditor.getState().select([itemId])
  requestAnimationFrame(() => {
    document
      .querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
