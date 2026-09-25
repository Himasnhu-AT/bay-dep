import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { useEditor, type RegionId } from '@/store/editor'

export interface CollapsiblePanel {
  panelRef: RefObject<PanelImperativeHandle | null>
  /** For the panel's `onResize`: a panel dragged shut against its edge reports itself hidden. */
  onResize(): void
  hidden: boolean
}

/**
 * Keeps a collapsible panel and a piece of state agreeing, in both directions.
 *
 * The state says whether the panel is hidden and the panel is made to agree: collapsing rather
 * than unmounting keeps its size, so showing it again puts it back. And a panel dragged shut
 * against its edge collapses on its own, so the state then follows the screen — its toggle must
 * read "hidden" rather than disagree with what is visible.
 *
 * The width a panel had when hidden is restored exactly: the library's own `expand()` re-solves
 * the whole group and brought a 236px inspector back at its 220px minimum when a neighbour was
 * wide. `restoreTo` is the size to open at when it was never open in this mount (a panel
 * remembered as collapsed).
 */
export function useCollapsiblePanel(
  hidden: boolean,
  setHidden: (hidden: boolean) => void,
  restoreTo: string
): CollapsiblePanel {
  const panelRef = usePanelRef()
  const sizeBeforeHide = useRef<number | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (hidden && !panel.isCollapsed()) {
      sizeBeforeHide.current = panel.getSize().inPixels
      panel.collapse()
    }
    if (!hidden && panel.isCollapsed()) {
      panel.expand()
      const before = sizeBeforeHide.current
      panel.resize(before ? `${Math.round(before)}px` : restoreTo)
    }
  }, [hidden, panelRef, restoreTo])

  const onResize = useCallback((): void => {
    const collapsed = panelRef.current?.isCollapsed()
    if (collapsed !== undefined && collapsed !== hidden) setHidden(collapsed)
  }, [panelRef, hidden, setHidden])

  return { panelRef, onResize, hidden }
}

/** A workspace region (library, inspector, timeline) shown and hidden through the store. */
export function useRegionPanel(region: RegionId, restoreTo: string): CollapsiblePanel {
  const hidden = useEditor((state) => state.hiddenRegions[region])
  const setRegionHidden = useEditor((state) => state.setRegionHidden)
  const setHidden = useCallback((next: boolean) => setRegionHidden(region, next), [region, setRegionHidden])
  return useCollapsiblePanel(hidden, setHidden, restoreTo)
}
