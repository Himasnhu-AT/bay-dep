import { useEffect, type ReactNode } from 'react'
import { useEditor } from '@/store/editor'

/**
 * Marks `<html data-playing>` while the timeline plays, so chrome glass (`.bay-glass` in
 * styles.css) turns solid for the duration.
 *
 * A `backdrop-filter` over the viewer has to re-filter every frame the viewer composites, and the
 * drawers and popovers that carry glass can sit over it. That cost was not measured in the running
 * app (it could not be, here), so glass is kept off the playing viewer by construction: paused,
 * the viewer does not redraw and the blur is computed once per change; playing, there is none.
 *
 * Its own component rendering nothing, so a play/pause re-renders this and not the workspace.
 */
export function PlayingMark(): ReactNode {
  const playing = useEditor((state) => state.playing)
  useEffect(() => {
    const root = document.documentElement
    if (playing) root.setAttribute('data-playing', '')
    else root.removeAttribute('data-playing')
    return () => root.removeAttribute('data-playing')
  }, [playing])
  return null
}
