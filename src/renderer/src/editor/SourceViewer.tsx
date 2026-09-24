import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRightToLine, Pause, Play, Plus, X } from 'lucide-react'
import type { Asset } from '@shared/project'
import { Button, IconButton, Slider } from '@/components'
import { assetUrl } from '@/engine/mediaPool'
import { endOfTimeline, placeAssetRange } from '@/lib/mediaActions'
import { revealItem } from '@/lib/revealItem'
import { useEditor } from '@/store/editor'
import { ASSET_DRAG_TYPE } from './AssetTile'

/**
 * A small source monitor for the asset selected in the Media panel: play it, scrub it, mark the
 * part you want with In and Out, then insert that part at the playhead or append it to the end.
 * Selecting an asset never edits the timeline; only these two buttons (or a double-click, Enter
 * or a drag in the panel) do.
 *
 * Its media element is its own — never one of the compositor's pooled elements, which the
 * preview seeks every frame — and it loads with CORS like the pool does, so the two share
 * Chromium's per-URL cache entry rather than racing two loads of one file.
 */

/** Source time as `m:ss.ff`, in frames of the source's own rate (or 30 when it has none). */
function formatSourceTime(us: number, fps: number | null): string {
  const rate = fps && fps > 0 ? fps : 30
  const totalFrames = Math.max(0, Math.floor((us / 1_000_000) * rate + 1e-6))
  const perSecond = Math.round(rate)
  const seconds = Math.floor(totalFrames / perSecond)
  const frames = totalFrames % perSecond
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

export function SourceViewer({ asset, onClose }: { asset: Asset; onClose(): void }): ReactNode {
  const notify = useEditor((state) => state.notify)
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [atUs, setAtUs] = useState(0)
  const [inUs, setInUs] = useState<number | null>(null)
  const [outUs, setOutUs] = useState<number | null>(null)

  const timed = (asset.kind === 'video' || asset.kind === 'audio') && asset.durationUs > 0
  const url = assetUrl(asset)
  const duration = asset.durationUs
  const step = 1_000_000 / (asset.fps && asset.fps > 0 ? asset.fps : 30)

  // A different asset starts from its beginning with no marks.
  useEffect(() => {
    setPlaying(false)
    setAtUs(0)
    setInUs(null)
    setOutUs(null)
  }, [asset.id])

  const seek = (us: number): void => {
    const clamped = Math.min(Math.max(0, us), duration)
    setAtUs(clamped)
    if (media.current) media.current.currentTime = clamped / 1_000_000
  }

  const toggle = (): void => {
    const element = media.current
    if (!element) return
    if (element.paused) {
      // From the out mark (or the end), playing starts again from the in mark.
      if (atUs >= (outUs ?? duration) - step) seek(inUs ?? 0)
      void element.play().catch(() => setPlaying(false))
    } else element.pause()
  }

  const markIn = (): void => {
    setInUs(atUs)
    if (outUs !== null && outUs <= atUs) setOutUs(null)
  }
  const markOut = (): void => {
    setOutUs(Math.max(atUs, step))
    if (inUs !== null && inUs >= atUs) setInUs(null)
  }

  const place = (where: 'playhead' | 'end'): void => {
    const placed = placeAssetRange(asset, {
      ...(where === 'end' ? { atFrame: endOfTimeline() } : {}),
      ...(inUs !== null ? { inUs } : {}),
      ...(outUs !== null ? { outUs } : {})
    })
    if (placed) {
      revealItem(placed)
      notify(`${asset.name} ${where === 'end' ? 'appended to the end' : 'inserted at the playhead'}. ⌘Z to undo.`)
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
          if (timed) seek(atUs - step * (event.shiftKey ? 10 : 1))
          return timed
        case 'ArrowRight':
          if (timed) seek(atUs + step * (event.shiftKey ? 10 : 1))
          return timed
        case 'Enter':
          place('playhead')
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

  const markedIn = inUs ?? 0
  const markedOut = outUs ?? duration
  const marked = inUs !== null || outUs !== null

  return (
    <section
      aria-label={`Source: ${asset.name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="border-b border-line px-3 pt-2 pb-3 outline-none"
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
              const us = event.currentTarget.currentTime * 1_000_000
              setAtUs(us)
              // Playback stops at the out mark, the way a source monitor plays a marked range.
              if (outUs !== null && us >= outUs && !event.currentTarget.paused) event.currentTarget.pause()
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
            <Slider label="Source position" value={atUs} min={0} max={duration} step={step} onInput={seek} onCommit={seek} />
            {marked && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-1 h-0.5 rounded-full bg-accent"
                style={{ left: `${(markedIn / duration) * 100}%`, width: `${((markedOut - markedIn) / duration) * 100}%` }}
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
            <span className="text-[11px] text-ink-2 tabular-nums">
              {formatSourceTime(atUs, asset.fps)} / {formatSourceTime(duration, asset.fps)}
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
              ? `Marked ${formatSourceTime(markedIn, asset.fps)} – ${formatSourceTime(markedOut, asset.fps)}`
              : 'No marks: the whole clip is used.'}
            {marked && (
              <button
                type="button"
                className="t-fast ml-1.5 rounded-xs text-ink-1 underline-offset-2 hover:text-ink-0 hover:underline focus-visible:outline-accent"
                onClick={() => {
                  setInUs(null)
                  setOutUs(null)
                }}
              >
                Clear
              </button>
            )}
          </p>
        </>
      )}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button
          variant="primary"
          icon={<Plus className="size-3.5" />}
          title={`Insert ${marked ? 'the marked part' : 'it'} at the playhead (Enter)`}
          onClick={() => place('playhead')}
        >
          Insert
        </Button>
        <Button
          variant="subtle"
          icon={<ArrowRightToLine className="size-3.5" />}
          title={`Append ${marked ? 'the marked part' : 'it'} after the end of the timeline`}
          onClick={() => place('end')}
        >
          Append
        </Button>
      </div>
    </section>
  )
}
