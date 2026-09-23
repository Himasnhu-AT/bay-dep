import { useRef, type ReactNode } from 'react'
import { Film } from 'lucide-react'
import { useElementSize } from '@/lib/useElementSize'
import { useEngine } from '@/lib/useEngine'
import { selectDuration, selectTimeline, useEditor } from '@/store/editor'
import { DebugHud } from './DebugHud'

/** The letterboxed rectangle for `aspect` inside `box`, inset so the canvas has air. */
function fitBox(
  boxWidth: number,
  boxHeight: number,
  aspect: number
): { width: number; height: number } {
  const available = Math.max(0, boxWidth - 24)
  const availableHeight = Math.max(0, boxHeight - 24)
  if (available <= 0 || availableHeight <= 0 || aspect <= 0) return { width: 0, height: 0 }
  const byWidth = { width: available, height: available / aspect }
  return byWidth.height <= availableHeight
    ? { width: Math.floor(byWidth.width), height: Math.floor(byWidth.height) }
    : { width: Math.floor(availableHeight * aspect), height: Math.floor(availableHeight) }
}

/**
 * The programme monitor.
 *
 * Two ownership lines worth naming. The *displayed* size of the canvas is layout, so it is
 * decided here from the observed container and the timeline's aspect. The canvas's
 * **backing-store** resolution is a rendering decision — whether to composite at project
 * resolution or at a cheaper preview resolution — so this component never writes
 * `canvas.width`/`canvas.height`. `useEngine` owns that, and having both write it is how a
 * preview ends up being cleared once per frame by whoever lost the race.
 */
export function Preview(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const size = useElementSize(containerRef)

  const engine = useEngine(canvasRef)
  const debugMode = useEditor((state) => state.debugMode)

  const aspect = timeline && timeline.height > 0 ? timeline.width / timeline.height : 16 / 9
  const box = fitBox(size.width, size.height, aspect)
  const empty = duration === 0

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-0"
    >
      {debugMode && <DebugHud stats={engine.stats} />}
      <div
        className="checkerboard relative shrink-0 border border-line"
        style={{ width: box.width || 1, height: box.height || 1 }}
      >
        {/* No background colour here on purpose. The compositor fills the timeline's own
            background; leaving the element transparent is what lets the checkerboard
            underneath actually mean something when a frame has alpha in it. */}
        <canvas ref={canvasRef} role="img" aria-label="Programme preview" className="block size-full" />
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
