import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRightToLine, Pause, Play, Plus, Replace, X } from 'lucide-react'
import type { Asset } from '@shared/project'
import { formatTimecode } from '@shared/timecode'
import { Button, IconButton, Slider } from '@/components'
import { assetUrl } from '@/engine/mediaPool'
import { editIntoTimeline, endOfTimeline, placeAssetRange } from '@/lib/mediaActions'
import { revealItem } from '@/lib/revealItem'
import { lastSourceFrame, sourceFrameAtSeconds, sourceFrameStartUs, sourceRate, sourceSeekSeconds } from '@/lib/sourcePosition'
import { useEditor } from '@/store/editor'
import { ASSET_DRAG_TYPE } from './AssetTile'

/**
 * A small source monitor for the asset selected in the Media panel: play it, scrub it, mark the
 * part you want with In and Out, then Insert it at the playhead (everything after slides right, on
 * every track), Overwrite what is there, or Append it to the end. Selecting an asset never edits
 * the timeline; only these buttons (or a double-click, Enter or a drag in the panel) do.
 *
 * Opening it from a click moves focus into it (`focusToken`), so I and O mark the source and not
 * the timeline's range.
 *
 * Its media element is its own — never one of the compositor's pooled elements, which the
 * preview seeks every frame — and it loads with CORS like the pool does, so the two share
 * Chromium's per-URL cache entry rather than racing two loads of one file.
 */

/** A source frame as the editor's one timecode, at the source's own rate (or 30). */
function formatSourceFrame(frame: number, rate: number): string {
  return formatTimecode(frame, rate)
}

export function SourceViewer({
  asset,
  onClose,
  focusToken = 0
}: {
  asset: Asset
  onClose(): void
  /** Changes each time a click opens this asset; the viewer then takes focus. */
  focusToken?: number
}): ReactNode {
  const notify = useEditor((state) => state.notify)
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const root = useRef<HTMLElement>(null)
  const [playing, setPlaying] = useState(false)
  // Whole frames of the source, never microseconds read back from the element (`sourcePosition`).
  const [atFrame, setAtFrame] = useState(0)
  const [inFrame, setInFrame] = useState<number | null>(null)
  const [outFrame, setOutFrame] = useState<number | null>(null)

  const timed = (asset.kind === 'video' || asset.kind === 'audio') && asset.durationUs > 0
  const url = assetUrl(asset)
  const duration = asset.durationUs
  const rate = sourceRate(asset.fps)
  const lastFrame = lastSourceFrame(duration, rate)
  const endFrame = lastFrame + 1

  // A different asset starts from its beginning with no marks.
  useEffect(() => {
    setPlaying(false)
    setAtFrame(0)
    setInFrame(null)
    setOutFrame(null)
  }, [asset.id])

  useEffect(() => {
    if (focusToken > 0) root.current?.focus({ preventScroll: true })
  }, [focusToken])

  const seek = (frame: number): void => {
    const clamped = Math.min(Math.max(0, Math.round(frame)), lastFrame)
    setAtFrame(clamped)
    if (media.current) media.current.currentTime = sourceSeekSeconds(clamped, rate)
  }

  const toggle = (): void => {
    const element = media.current
    if (!element) return
    if (element.paused) {
      // From the out mark (or the end), playing starts again from the in mark.
      if (atFrame >= (outFrame ?? endFrame) - 1) seek(inFrame ?? 0)
      void element.play().catch(() => setPlaying(false))
    } else element.pause()
  }

  const markIn = (): void => {
    setInFrame(atFrame)
    if (outFrame !== null && outFrame <= atFrame) setOutFrame(null)
  }
  const markOut = (): void => {
    // The out mark is where the kept part ends: the start of the frame shown, at least one frame in.
    setOutFrame(Math.max(atFrame, 1))
    if (inFrame !== null && inFrame >= atFrame) setInFrame(null)
  }

  const place = (where: 'insert' | 'overwrite' | 'end'): void => {
    // Marks go to the timeline as the exact start of their frames.
    const range = {
      ...(inFrame !== null ? { inUs: sourceFrameStartUs(inFrame, rate) } : {}),
      ...(outFrame !== null ? { outUs: Math.min(duration, sourceFrameStartUs(outFrame, rate)) } : {})
    }
    const placed =
      where === 'end' ? placeAssetRange(asset, { atFrame: endOfTimeline(), ...range }) : editIntoTimeline(asset, where, range)
    if (placed) {
      revealItem(placed)
      const what = { insert: 'inserted at the playhead', overwrite: 'written over the playhead', end: 'appended to the end' }[where]
      notify(`${asset.name} ${what}. ⌘Z to undo.`)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const handled = (() => {
      switch (event.key) {
        case ' ':
          if (timed) toggle()
          return timed
        case 'i':
        case 'I':
          if (timed) markIn()
          return timed
        case 'o':
        case 'O':
          if (timed) markOut()
          return timed
        case 'ArrowLeft':
          if (timed) seek(atFrame - (event.shiftKey ? 10 : 1))
          return timed
        case 'ArrowRight':
          if (timed) seek(atFrame + (event.shiftKey ? 10 : 1))
          return timed
        // Final Cut's keys for the three edits; the timeline's own W/D/E never see them here.
        case 'Enter':
        case 'w':
        case 'W':
          place('insert')
          return true
        case 'd':
        case 'D':
          place('overwrite')
          return true
        case 'e':
        case 'E':
          place('end')
          return true
        default:
          return false
      }
    })()
    // Kept from the editor's own shortcuts: Space here plays this source, not the timeline,
    // and I/O mark it, not the timeline's range.
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const markedIn = inFrame ?? 0
  const markedOut = outFrame ?? endFrame
  const marked = inFrame !== null || outFrame !== null

  return (
    <section
      ref={root}
      aria-label={`Source: ${asset.name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="@container border-b border-line px-3 pt-2 pb-3 outline-none"
    >
      <div className="mb-1.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-[11px] text-ink-1" title={asset.name}>
          {asset.name}
        </p>
        <IconButton label="Close source" size="xs" icon={<X className="size-3" />} onClick={onClose} />
      </div>

      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
          event.dataTransfer.effectAllowed = 'copy'
        }}
        className="relative aspect-video w-full overflow-hidden rounded-sm bg-black"
      >
        {url && (asset.kind === 'image' || asset.kind === 'gif') ? (
          <img src={url} alt="" draggable={false} crossOrigin="anonymous" className="size-full object-contain" />
        ) : url && timed ? (
          <video
            ref={media}
            src={url}
            crossOrigin="anonymous"
            preload="auto"
            playsInline
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const frame = Math.min(sourceFrameAtSeconds(event.currentTarget.currentTime, rate), lastFrame)
              setAtFrame(frame)
              // Playback stops at the out mark, the way a source monitor plays a marked range.
              if (outFrame !== null && frame >= outFrame && !event.currentTarget.paused) event.currentTarget.pause()
            }}
            className={asset.kind === 'audio' ? 'hidden' : 'size-full object-contain'}
          />
        ) : null}
        {asset.kind === 'audio' && (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-on-media/70">Audio</div>
        )}
      </div>

      {timed && (
        <>
          <div className="relative mt-2">
            <Slider label="Source position" value={atFrame} min={0} max={lastFrame} step={1} onInput={seek} onCommit={seek} />
            {marked && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-1 h-0.5 rounded-full bg-accent"
                style={{ left: `${(markedIn / endFrame) * 100}%`, width: `${((markedOut - markedIn) / endFrame) * 100}%` }}
              />
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <IconButton
              label={playing ? 'Pause source' : 'Play source'}
              shortcut="Space"
              size="xs"
              icon={playing ? <Pause className="size-3" /> : <Play className="size-3" />}
              onClick={toggle}
            />
            {/* One line, always. In the 300 px panel "position / length" wrapped onto two lines
                and pushed the row taller; below 24rem of panel the length goes (the slider shows
                where in the clip you are, and the tooltip still says it). */}
            <span
              className="shrink-0 text-[11px] whitespace-nowrap text-ink-2 tabular-nums"
              title={`${formatSourceFrame(atFrame, rate)} of ${formatSourceFrame(endFrame, rate)}`}
            >
              {formatSourceFrame(atFrame, rate)}
              <span className="hidden @sm:inline"> / {formatSourceFrame(endFrame, rate)}</span>
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={markIn} title="Mark in (I)">
              Mark in
            </Button>
            <Button size="sm" variant="ghost" onClick={markOut} title="Mark out (O)">
              Mark out
            </Button>
          </div>
          <p className="mt-0.5 text-[10px] text-ink-2 tabular-nums">
            {marked
              ? `Marked ${formatSourceFrame(markedIn, rate)} – ${formatSourceFrame(markedOut, rate)}`
              : 'No marks: the whole clip is used.'}
            {marked && (
              <button
                type="button"
                className="t-fast ml-1.5 rounded-xs text-ink-1 underline-offset-2 hover:text-ink-0 hover:underline focus-visible:outline-accent"
                onClick={() => {
                  setInFrame(null)
                  setOutFrame(null)
                }}
              >
                Clear
              </button>
            )}
          </p>
        </>
      )}

      {/* Flex, not three equal columns: "Overwrite" is wider than a third of the 300 px panel,
          and equal columns squeezed its icon to a dot. Each button now takes its own width
          plus an equal share of what is left. */}
      <div className="mt-2 flex gap-1.5">
        <Button
          className="flex-1"
          variant="primary"
          icon={<Plus className="size-3.5" />}
          title={`Insert ${marked ? 'the marked part' : 'it'} at the playhead; everything after slides right (W or Enter)`}
          onClick={() => place('insert')}
        >
          Insert
        </Button>
        <Button
          className="flex-1"
          variant="subtle"
          icon={<Replace className="size-3.5" />}
          title={`Overwrite what is at the playhead with ${marked ? 'the marked part' : 'it'}; nothing moves (D)`}
          onClick={() => place('overwrite')}
        >
          Overwrite
        </Button>
        <Button
          className="flex-1"
          variant="subtle"
          icon={<ArrowRightToLine className="size-3.5" />}
          title={`Append ${marked ? 'the marked part' : 'it'} after the end of the timeline (E)`}
          onClick={() => place('end')}
        >
          Append
        </Button>
      </div>
    </section>
  )
}
