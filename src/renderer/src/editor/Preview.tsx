import { useEffect, useRef, type ReactNode } from 'react'
import { Film } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useElementSize } from '@/lib/useElementSize'
import { useEngine } from '@/lib/useEngine'
import { useViewer } from '@/lib/viewer'
import { selectDuration, selectTimeline, useEditor } from '@/store/editor'
import { DebugHud } from './DebugHud'
import { viewerSize } from './viewer/geometry'
import { Guides } from './viewer/Guides'
import { TransformOverlay } from './viewer/TransformOverlay'

/**
 * The programme monitor.
 *
 * Two ownership lines worth naming. The *displayed* size of the canvas is layout, so it is
 * decided here from the observed container, the timeline's aspect and the viewer zoom. The
 * canvas's **backing-store** resolution is a rendering decision — whether to composite at
 * project resolution or at a cheaper preview resolution — so this component never writes
 * `canvas.width`/`canvas.height`. `useEngine` owns that (and follows the displayed size, so 200%
 * composites at up to project resolution rather than scaling up a small picture), and having
 * both write it is how a preview ends up being cleared once per frame by whoever lost the race.
 *
 * Everything drawn over the picture — handles, snap guides, safe areas — is DOM above the
 * canvas, never pixels in it, so `preview_frame` and export cannot contain any of it.
 */
export function Preview(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const size = useElementSize(containerRef)

  const engine = useEngine(canvasRef)
  const debugMode = useEditor((state) => state.debugMode)
  const zoom = useViewer((state) => state.zoom)
  const fullscreen = useViewer((state) => state.fullscreen)
  const safeAreas = useViewer((state) => state.safeAreas)
  const grid = useViewer((state) => state.grid)

  // The meters beside the transport read the engine's analysers through this.
  useEffect(() => {
    useViewer.getState().setEngine(engine)
    return () => useViewer.getState().setEngine(null)
  }, [engine])

  // Escape leaves full screen, before the app-level Escape (which closes dialogs) sees it.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      useViewer.getState().setFullscreen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullscreen])

  const canvas = { width: timeline?.width ?? 1920, height: timeline?.height ?? 1080 }
  // Full screen always fits: it is for watching, and a zoomed full screen has no scroll bars to
  // find your way around with.
  const box = viewerSize(fullscreen || zoom === 'fit' ? 'fit' : Number(zoom), canvas, size, fullscreen ? 0 : 24)
  // The overlay lives inside the 1px border, so it maps onto the canvas's own box.
  const inner = Math.max(0, box.width - 2)
  const scale = canvas.width > 0 ? inner / canvas.width : 0
  const empty = duration === 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 flex-1 bg-surface-0',
        fullscreen ? 'fixed inset-0 z-(--z-overlay)' : 'relative',
        zoom === 'fit' || fullscreen ? 'overflow-hidden' : 'overflow-auto'
      )}
    >
      {debugMode && <DebugHud stats={engine.stats} />}
      {/* `m-auto` rather than centring the parent: a flex-centred child larger than its scroll
          container overflows on both sides, and the left half can never be scrolled to. */}
      <div
        className="checkerboard relative m-auto shrink-0 border border-line"
        style={{ width: box.width || 1, height: box.height || 1 }}
      >
        {/* No background colour here on purpose. The compositor fills the timeline's own
            background; leaving the element transparent is what lets the checkerboard
            underneath actually mean something when a frame has alpha in it. */}
        <canvas ref={canvasRef} role="img" aria-label="Programme preview" className="block size-full" />
        <Guides safeAreas={safeAreas} grid={grid} />
        {!empty && <TransformOverlay scale={scale} canvas={canvas} />}
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <Film aria-hidden="true" className="size-6 text-ink-2" />
            <p className="text-[12px] text-ink-2">Nothing on the timeline yet</p>
            <p className="max-w-[36ch] text-[11px] text-ink-2/70">
              Import media and click a clip to place it at the playhead.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
