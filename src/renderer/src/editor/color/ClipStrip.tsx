import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Code2, Film, Image as ImageIcon } from 'lucide-react'
import { formatTimecode, sourceEdgeAt, type Asset, type Item } from '@shared/project'
import { cn } from '@/lib/cn'
import { stripFrameIndex } from '@/lib/mediaKinds'
import { useFilmstrip, usePoster } from '@/lib/useMediaCache'
import { selectTimeline, useEditor } from '@/store/editor'
import { colorClips, type ColorClip } from './clips'

/**
 * The timeline's own filmstrip request (`Clip.tsx`: 24 frames at 100px), so a thumbnail here is
 * a cache hit whenever the clip is on screen in the timeline, and one request otherwise.
 */
const STRIP_FRAMES = 24
const STRIP_HEIGHT = 100

export interface ClipStripProps {
  className?: string
}

/**
 * The Color page's clip strip (Resolve's "Clips" thumbnail timeline): every picture clip on the
 * timeline, numbered in time order, with its track and start. Clicking one selects it on the
 * timeline and moves the playhead to its first frame, so the viewer shows what is being graded.
 * A small orange dot marks a clip whose look already changes its picture.
 */
export function ClipStrip({ className }: ClipStripProps): ReactNode {
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const selection = useEditor((state) => state.selection)
  const clips = useMemo(() => (timeline ? colorClips(project, timeline) : []), [project, timeline])
  const selected = new Set(selection)
  const listRef = useRef<HTMLDivElement>(null)

  // The selected clip scrolled into view — selecting on the timeline should find it here too.
  const firstSelected = clips.find((clip) => selected.has(clip.item.id))?.item.id
  useEffect(() => {
    if (!firstSelected) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(firstSelected)}"]`)
    node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [firstSelected])

  const choose = (clip: ColorClip): void => {
    const state = useEditor.getState()
    state.select([clip.item.id])
    state.setPlayhead(clip.item.from)
  }

  return (
    <section aria-label="Clips" className={cn('flex min-w-0 flex-col bg-surface-1', className)}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised px-3">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-0 uppercase">Clips</h2>
        <span className="text-[11px] text-ink-2 tabular-nums">{clips.length}</span>
      </header>
      {clips.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-ink-2">
          No picture clips on this timeline yet. Place video or images on a video track to grade them here.
        </p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Clips to grade"
          aria-orientation="horizontal"
          className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto px-2 py-2"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            event.preventDefault()
            const at = clips.findIndex((clip) => clip.item.id === firstSelected)
            const next = clips[Math.min(clips.length - 1, Math.max(0, at + (event.key === 'ArrowRight' ? 1 : -1)))]
            if (next) {
              choose(next)
              listRef.current?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(next.item.id)}"]`)?.focus()
            }
          }}
        >
          {clips.map((clip) => (
            <ClipTile
              key={clip.item.id}
              clip={clip}
              fps={timeline?.fps ?? 30}
              selected={selected.has(clip.item.id)}
              focusable={firstSelected ? clip.item.id === firstSelected : clip.number === 1}
              onChoose={choose}
            />
          ))}
        </div>
      )}
    </section>
  )
}

const ClipTile = memo(function ClipTile({
  clip,
  fps,
  selected,
  focusable,
  onChoose
}: {
  clip: ColorClip
  fps: number
  selected: boolean
  focusable: boolean
  onChoose(clip: ColorClip): void
}): ReactNode {
  const name = clip.asset?.name ?? 'Missing media'
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`Clip ${clip.number}: ${name}, ${clip.trackName} at ${formatTimecode(clip.item.from, fps, true)}${clip.adjusted ? ', graded' : ''}`}
      data-clip-id={clip.item.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onChoose(clip)}
      className={cn(
        't-press group flex w-[132px] shrink-0 flex-col overflow-hidden rounded-sm border text-left',
        selected ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:border-line-strong'
      )}
    >
      <div className="relative aspect-video w-full bg-black">
        <Thumbnail asset={clip.asset} item={clip.item} fps={fps} />
        <span className="absolute top-1 left-1 rounded-xs bg-black/70 px-1 font-mono text-[10px] leading-4 text-white tabular-nums">
          {String(clip.number).padStart(2, '0')}
        </span>
        {clip.adjusted && (
          <span aria-hidden="true" title="Graded" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-1 ring-black/60" />
        )}
      </div>
      <div className="flex min-w-0 flex-col px-1.5 py-1">
        <span className={cn('truncate text-[11px]', selected ? 'text-ink-0' : 'text-ink-1')}>{name}</span>
        <span className="truncate text-[10px] text-ink-2 tabular-nums">
          {clip.trackName} · {formatTimecode(clip.item.from, fps, true)}
        </span>
      </div>
    </button>
  )
})

/** The frame at the middle of what the clip plays, from the filmstrip; the poster for a still. */
function Thumbnail({ asset, item, fps }: { asset: Asset | undefined; item: Item; fps: number }): ReactNode {
  const moving = asset?.kind === 'video' || asset?.kind === 'gif'
  const strip = useFilmstrip(asset, STRIP_FRAMES, STRIP_HEIGHT, moving)
  const poster = usePoster(asset, 220)
  const middleUs = sourceEdgeAt(item, item.durationInFrames / 2, fps)
  const index = asset ? stripFrameIndex(strip.length, middleUs, asset.durationUs) : -1
  const src = (index >= 0 ? strip[index] : undefined) ?? poster
  if (src) {
    return <img src={src} alt="" draggable={false} className="size-full object-cover" onError={(event) => (event.currentTarget.style.visibility = 'hidden')} />
  }
  const Icon = asset?.kind === 'html' || asset?.kind === 'brf' ? Code2 : asset?.kind === 'image' ? ImageIcon : Film
  return (
    <span className="flex size-full items-center justify-center text-ink-2">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  )
}
