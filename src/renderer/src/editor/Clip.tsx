import { memo, type ReactNode } from 'react'
import {
  AlertTriangle,
  Code2,
  ImageIcon,
  Music2,
  Type as TypeIcon,
  Video,
  type LucideIcon,
  Palette,
  Sparkles
} from 'lucide-react'
import { US_PER_SECOND, type Asset, type AssetKind, type Item } from '@shared/project'
import { cn } from '@/lib/cn'
import { useFilmstrip, useWaveform } from '@/lib/useMediaCache'

/** Below this width a clip is a coloured sliver; fetching pictures for it is wasted work. */
const THUMBS_MIN_WIDTH = 96
const STRIP_FRAMES = 24
/**
 * Filmstrip frames are requested at this many *device* pixels tall.
 *
 * It was 36, and that was measured to be wrong: a 1080x1920 source came back as 20x36 and
 * got stretched across 203px-wide columns — a 10x upscale, which is why a zoomed-in clip
 * looked like coloured mud. A video lane is 58px minus 8px of inset, so 100 device pixels
 * covers it at 2x with nothing to spare and nothing wasted.
 */
const STRIP_HEIGHT = 100
const WAVEFORM_BUCKETS = 600

export interface ClipProps {
  item: Item
  asset: Asset | undefined
  fps: number
  pixelsPerFrame: number
  height: number
  selected: boolean
  locked: boolean
  /** Live drag/trim preview. The store is not written until the pointer goes up. */
  previewFrom: number
  previewDuration: number
  dragging: boolean
  /** The item is passed back so the timeline can keep one stable handler for every clip —
   * a fresh closure per clip per render would defeat the `memo` below. */
  onPointerDownBody(event: React.PointerEvent, item: Item): void
  onPointerDownTrim(event: React.PointerEvent, item: Item, edge: 'start' | 'end'): void
}

/**
 * Typed `Record<AssetKind, ...>` on purpose: an untyped literal lets a new asset kind index to
 * `undefined`, React renders `<undefined />`, and the whole tree unmounts to a blank window
 * with nothing in the console. That is not hypothetical — adding `html` did exactly that, and
 * both typecheck and the test suite stayed green because neither can see a missing key in an
 * object literal nobody declared exhaustive. The annotation turns the next one into a build
 * error.
 */
const KIND_ICON: Record<AssetKind, LucideIcon> = {
  video: Video,
  audio: Music2,
  image: ImageIcon,
  gif: ImageIcon,
  text: TypeIcon,
  html: Code2,
  brf: Sparkles,
  lut: Palette
}

/**
 * Filmstrip frames are evenly spaced across the whole *source*, but a clip shows an
 * arbitrary window into it. So rather than stretching the strip to the clip, each column
 * asks "what source time am I?" and takes the nearest strip frame — which keeps the
 * pictures on a trimmed or speed-changed clip lined up with what actually plays there.
 */
function Filmstrip({
  frames,
  item,
  asset,
  fps,
  width,
  height
}: {
  frames: string[]
  item: Item
  asset: Asset
  fps: number
  width: number
  height: number
}): ReactNode {
  if (frames.length === 0 || asset.durationUs <= 0) return null
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9
  // One column per frame-width of clip, so a picture is never stretched past its natural
  // aspect at lane height. Capped, because a long clip zoomed in would otherwise want
  // hundreds of nodes; past the cap the columns are wider than a frame and `auto 100%`
  // below tiles rather than magnifies.
  const naturalColumn = Math.max(16, height * aspect)
  const columns = Math.min(48, Math.max(1, Math.round(width / naturalColumn)))

  return (
    <div aria-hidden="true" className="absolute inset-0 flex overflow-hidden opacity-55">
      {Array.from({ length: columns }, (_, column) => {
        const localFrames = (column / columns) * item.durationInFrames
        const sourceUs = item.sourceStartUs + (localFrames / fps) * US_PER_SECOND * item.speed
        const ratio = Math.min(0.999, Math.max(0, sourceUs / asset.durationUs))
        const url = frames[Math.min(frames.length - 1, Math.floor(ratio * frames.length))]
        return (
          <div
            key={column}
            className="h-full shrink-0"
            style={{
              width: `${100 / columns}%`,
              backgroundImage: url ? `url("${url}")` : undefined,
              // `auto 100%` pins the frame to the lane height at its own aspect instead of
              // blowing it up to the column width; repeat-x fills what is left with more
              // frames, which is what a filmstrip is, rather than one smeared picture.
              backgroundSize: 'auto 100%',
              backgroundRepeat: 'repeat-x',
              backgroundPosition: 'left center'
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * The peaks cover the whole source at a fixed bucket count, so the clip slices the window
 * it plays out of them. Drawn as one SVG polygon rather than N divs: a 600-bucket waveform
 * as elements is 600 nodes per clip, and a timeline has a lot of clips.
 */
function Waveform({
  peaks,
  item,
  asset,
  fps,
  height
}: {
  peaks: number[]
  item: Item
  asset: Asset
  fps: number
  height: number
}): ReactNode {
  if (peaks.length === 0) return null
  const sourceSpanUs =
    asset.durationUs > 0
      ? asset.durationUs
      : (item.durationInFrames / fps) * US_PER_SECOND * item.speed
  if (sourceSpanUs <= 0) return null

  const startRatio = Math.min(1, Math.max(0, item.sourceStartUs / sourceSpanUs))
  const spanRatio = Math.min(
    1 - startRatio,
    ((item.durationInFrames / fps) * US_PER_SECOND * item.speed) / sourceSpanUs
  )
  const columns = 160
  const half = height / 2
  const top: string[] = []
  const bottom: string[] = []
  for (let column = 0; column <= columns; column += 1) {
    const ratio = startRatio + (column / columns) * Math.max(0.0001, spanRatio)
    const peak = peaks[Math.min(peaks.length - 1, Math.floor(ratio * peaks.length))] ?? 0
    const x = (column / columns) * 100
    const amplitude = Math.min(1, Math.max(0, peak)) * (half - 1)
    top.push(`${x},${half - amplitude}`)
    bottom.push(`${x},${half + amplitude}`)
  }

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
    >
      <polygon points={[...top, ...bottom.reverse()].join(' ')} fill="var(--color-waveform)" fillOpacity="0.45" />
    </svg>
  )
}

function ClipImpl({
  item,
  asset,
  fps,
  pixelsPerFrame,
  height,
  selected,
  locked,
  previewFrom,
  previewDuration,
  dragging,
  onPointerDownBody,
  onPointerDownTrim
}: ClipProps): ReactNode {
  const width = Math.max(2, previewDuration * pixelsPerFrame)
  const audio = asset?.kind === 'audio' || (asset ? !asset.hasVideo && asset.hasAudio : false)
  const Icon = asset ? KIND_ICON[asset.kind] : AlertTriangle
  const showThumbs = width >= THUMBS_MIN_WIDTH

  const strip = useFilmstrip(asset, STRIP_FRAMES, STRIP_HEIGHT, showThumbs && !audio)
  const peaks = useWaveform(asset, WAVEFORM_BUCKETS, showThumbs && Boolean(asset?.hasAudio))

  const fadeIn = item.fadeInFrames * pixelsPerFrame
  const fadeOut = item.fadeOutFrames * pixelsPerFrame

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={asset?.name ?? 'Missing media'}
      onPointerDown={(event) => onPointerDownBody(event, item)}
      style={{
        left: previewFrom * pixelsPerFrame,
        width,
        height: height - 8,
        top: 4,
        backgroundColor: audio ? 'var(--color-clip-audio)' : 'var(--color-clip-video)',
        borderColor: selected
          ? 'var(--color-accent)'
          : audio
            ? 'var(--color-clip-audio-edge)'
            : 'var(--color-clip-video-edge)'
      }}
      className={cn(
        'group absolute overflow-hidden rounded-sm border select-none',
        locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        selected && 'ring-1 ring-accent',
        dragging && 'z-10 opacity-85 shadow-pop'
      )}
    >
      {asset && !audio && showThumbs && (
        <Filmstrip
          frames={strip}
          item={item}
          asset={asset}
          fps={fps}
          width={width}
          height={height - 8}
        />
      )}
      {asset && audio && showThumbs && (
        <Waveform peaks={peaks} item={item} asset={asset} fps={fps} height={height - 8} />
      )}

      {/* Fades are geometry on the clip, the way they read in every editor: a wedge. */}
      {fadeIn > 1 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/45"
          style={{ width: fadeIn, clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}
        />
      )}
      {fadeOut > 1 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/45"
          style={{ width: fadeOut, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        />
      )}

      <div className="pointer-events-none relative flex h-full items-start gap-1 px-1.5 py-1">
        <Icon aria-hidden="true" className="mt-px size-3 shrink-0 text-on-media/70" />
        <span className="truncate text-[11px] leading-tight font-medium text-on-media [text-shadow:0_1px_2px_rgb(0_0_0/0.65)]">
          {asset?.name ?? 'Missing media'}
        </span>
        {item.speed !== 1 && (
          <span className="ml-auto shrink-0 rounded-xs bg-black/55 px-1 text-[10px] text-on-media tabular-nums">
            {item.speed}×
          </span>
        )}
      </div>

      {/*
        Trim handles are 8px of hit area on a 1px-looking edge. Anything narrower and
        grabbing the edge of a clip becomes a test of mouse skill rather than an edit.
      */}
      {!locked && (
        <>
          <div
            role="presentation"
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDownTrim(event, item, 'start')
            }}
            className="t-fast absolute inset-y-0 left-0 w-2 cursor-col-resize bg-accent/0 hover:bg-accent/70"
          />
          <div
            role="presentation"
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDownTrim(event, item, 'end')
            }}
            className="t-fast absolute inset-y-0 right-0 w-2 cursor-col-resize bg-accent/0 hover:bg-accent/70"
          />
        </>
      )}
    </div>
  )
}

/**
 * Memoised because the timeline re-renders on every selection change and every zoom step,
 * and a clip that recomputes its filmstrip mapping each time is the difference between a
 * responsive drag and a sticky one on a project with a hundred clips.
 */
export const Clip = memo(ClipImpl)
