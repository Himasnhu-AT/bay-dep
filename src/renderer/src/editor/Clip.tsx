import { memo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Code2,
  Link2,
  VolumeX,
  ImageIcon,
  Music2,
  Type as TypeIcon,
  Video,
  type LucideIcon,
  Palette,
  Sparkles,
  SlidersHorizontal
} from 'lucide-react'
import { plainTime, sourceEdgeAt, US_PER_SECOND, type Asset, type AssetKind, type Item } from '@shared/project'
import { retimeSound } from '@shared/retime-sound'
import { hasSpeedCurve, speedCurveLabel } from '@shared/speed-curve'
import { cn } from '@/lib/cn'
import { clampFade, formatDb, volumeAtY, yForVolume } from '@/lib/timelineLayout'
import { useDrag } from '@/lib/useDrag'
import { useEditor } from '@/store/editor'
import { usePoster, useFilmstrip, useWaveform } from '@/lib/useMediaCache'
import { laneFrames, stripFrameIndex, wantsLanePoster } from '@/lib/mediaKinds'
import { BLADE_CURSOR } from '@/lib/timelineTool'

/** Below this width a clip is a coloured sliver; fetching pictures for it is wasted work. */
const THUMBS_MIN_WIDTH = 96
const STRIP_FRAMES = 24
/** A trim handle; with ⌥ held (or a trim mode armed) it rolls the cut, and the cursor says so. */
const TRIM_HANDLE_CLASS =
  't-fast absolute inset-y-0 w-2 cursor-col-resize bg-accent/0 hover:bg-accent/70 ' +
  'in-data-[trim-hint=slip]:cursor-ew-resize! in-data-[trim-hint=slide]:cursor-ew-resize! in-data-[trim-hint=roll]:cursor-ew-resize!'

/**
 * The name band along a clip's top, in the clip kind's colour: the part of the clip that says
 * what kind of object it is whatever the footage looks like. Without it a clip's colour was its
 * filmstrip's, and two video clips on neighbouring tracks — one bright footage, one dark — read
 * as two different kinds of thing. Drawn only on a clip tall enough to keep a picture under it.
 */
const BAND_HEIGHT = 15
const BAND_MIN_CLIP_HEIGHT = 30

/**
 * One body colour and one edge colour per kind of clip, as Resolve does: picture blue, sound
 * green, titles purple, motion graphics and compositions amber. Video and audio are the theme's
 * tokens; titles and motion read tokens the stylesheet may define, with a fallback of the same
 * depth as the others, since these are media colours that do not change with the theme.
 */
type ClipTint = 'video' | 'audio' | 'title' | 'motion'

const TINTS: Record<ClipTint, { body: string; edge: string }> = {
  video: { body: 'var(--color-clip-video)', edge: 'var(--color-clip-video-edge)' },
  audio: { body: 'var(--color-clip-audio)', edge: 'var(--color-clip-audio-edge)' },
  title: { body: 'var(--color-clip-title)', edge: 'var(--color-clip-title-edge)' },
  motion: { body: 'var(--color-clip-motion)', edge: 'var(--color-clip-motion-edge)' }
}

/**
 * The picture or waveform sits this far inside the clip's sides and bottom, so the kind's body
 * colour frames it. Edge to edge, a filmstrip covered the body entirely and a clip's colour was
 * its footage's: a still and a video on neighbouring tracks, one bright and one dark, read as two
 * kinds of object with only the thin band to say otherwise.
 */
const PICTURE_INSET = 2

function tintOf(asset: Asset | undefined, audio: boolean): ClipTint {
  if (audio) return 'audio'
  if (asset?.kind === 'text') return 'title'
  if (asset?.kind === 'brf' || asset?.kind === 'html') return 'motion'
  return 'video'
}

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
  /** On a hidden track: the clip draws nothing in the picture, so it is drawn dimmed here. */
  hidden?: boolean
  /** The kind of track the clip sits on: a video file's detached sound draws as audio. */
  trackKind: 'video' | 'audio'
  /** Live drag/trim preview. The store is not written until the pointer goes up. */
  previewFrom: number
  previewDuration: number
  dragging: boolean
  /** The blade tool is in hand: the clip is a cut target, so its drag handles are hidden. */
  blade?: boolean
  /** The Trim tool is in hand: every drag trims, so the fade corners and volume line step aside. */
  trimTool?: boolean
  /** The item is passed back so the timeline can keep one stable handler for every clip —
   * a fresh closure per clip per render would defeat the `memo` below. */
  onPointerDownBody(event: React.PointerEvent, item: Item): void
  onPointerDownTrim(event: React.PointerEvent, item: Item, edge: 'start' | 'end'): void
  onContextMenu(event: React.MouseEvent, item: Item): void
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
  lut: Palette,
  font: TypeIcon,
  adjustment: SlidersHorizontal
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
  if (frames.length === 0) return null
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9
  // One column per frame-width of clip, so a picture is never stretched past its natural
  // aspect at lane height. Capped, because a long clip zoomed in would otherwise want
  // hundreds of nodes; past the cap the columns are wider than a frame and `auto 100%`
  // below tiles rather than magnifies.
  const naturalColumn = Math.max(16, height * aspect)
  const columns = Math.min(48, Math.max(1, Math.round(width / naturalColumn)))

  return (
    <div aria-hidden="true" className="absolute inset-0 flex overflow-hidden opacity-70">
      {Array.from({ length: columns }, (_, column) => {
        const localFrames = (column / columns) * item.durationInFrames
        // Through the one mapping, so a reversed clip's strip runs backwards and a ramp's slow
        // stretch shows the same picture across more columns.
        const sourceUs = sourceEdgeAt(item, localFrames, fps)
        const url = frames[stripFrameIndex(frames.length, sourceUs, asset.durationUs)]
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
  const plain = plainTime(item)
  const top: string[] = []
  const bottom: string[] = []
  for (let column = 0; column <= columns; column += 1) {
    // A reversed or ramped clip is not one straight slice of the peaks: each column asks the one
    // mapping what it plays.
    const ratio = plain
      ? startRatio + (column / columns) * Math.max(0.0001, spanRatio)
      : Math.min(1, Math.max(0, sourceEdgeAt(item, (column / columns) * item.durationInFrames, fps) / sourceSpanUs))
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

/** The speed badge of a reversed or ramped clip: what it shows, and what it says on hover. */
function retimeBadge(item: Item): { text: string; label: string; title: string } {
  const ramped = hasSpeedCurve(item)
  const pace = ramped ? speedCurveLabel(item) : item.speed !== 1 ? `${item.speed}×` : ''
  const text = `${item.reverse ? '◀ ' : ''}${ramped ? `ramp ${pace}` : pace}`.trim() || '◀'
  const label = [item.reverse ? 'Reversed' : null, ramped ? `speed ramp ${pace}` : pace ? `speed ${pace}` : null].filter(Boolean).join(', ')
  const notice = retimeSound(item).notice
  return { text, label, title: notice ? `${label}. ${notice}` : label }
}

function ClipImpl({
  item,
  asset,
  fps,
  pixelsPerFrame,
  height,
  selected,
  locked,
  hidden = false,
  trackKind,
  previewFrom,
  previewDuration,
  dragging,
  blade = false,
  trimTool = false,
  onPointerDownBody,
  onPointerDownTrim,
  onContextMenu
}: ClipProps): ReactNode {
  const width = Math.max(2, previewDuration * pixelsPerFrame)
  const audio =
    trackKind === 'audio' || asset?.kind === 'audio' || (asset ? !asset.hasVideo && asset.hasAudio : false)
  // A video file's detached sound, on an audio track, is sound: it gets the sound icon.
  const Icon = !asset ? AlertTriangle : audio ? Music2 : KIND_ICON[asset.kind]
  const disabled = item.disabled === true
  const innerHeight = height - 8
  const showThumbs = width >= THUMBS_MIN_WIDTH
  const tint = TINTS[tintOf(asset, audio)]
  const band = innerHeight >= BAND_MIN_CLIP_HEIGHT ? BAND_HEIGHT : 0
  // The border is 1px each side; the picture's own box is what the filmstrip and waveform fill.
  const pictureHeight = Math.max(0, innerHeight - 2 - band - PICTURE_INSET)

  const strip = useFilmstrip(asset, STRIP_FRAMES, STRIP_HEIGHT, showThumbs && !audio)
  // A still has no filmstrip; its lane repeats the poster. 220 is the media tile's size (long
  // edge, so a 16:9 still is 124 px tall, over STRIP_HEIGHT), so the tile's request already made
  // it and this is a cache hit.
  const poster = usePoster(asset && showThumbs && !audio && wantsLanePoster(asset) ? asset : undefined, 220)
  const lane = asset ? laneFrames(asset, strip, poster) : strip
  const peaks = useWaveform(asset, WAVEFORM_BUCKETS, showThumbs && Boolean(asset?.hasAudio))

  const [fadeDrag, setFadeDrag] = useState<{ edge: 'in' | 'out'; frames: number } | null>(null)
  const [volumeDrag, setVolumeDrag] = useState<number | null>(null)
  const fadeInFrames = fadeDrag?.edge === 'in' ? fadeDrag.frames : item.fadeInFrames
  const fadeOutFrames = fadeDrag?.edge === 'out' ? fadeDrag.frames : item.fadeOutFrames
  const fadeIn = fadeInFrames * pixelsPerFrame
  const fadeOut = fadeOutFrames * pixelsPerFrame

  // Fade handles: the same two fields the inspector's Fade in / Fade out write, so dragging one
  // is that field. One undo step, on release; the drag itself only redraws this clip.
  const beginFade = useDrag({
    threshold: 1,
    onMove: (state) => {
      setFadeDrag((current) => {
        if (!current) return current
        const start = current.edge === 'in' ? item.fadeInFrames : item.fadeOutFrames
        const raw = start + (current.edge === 'in' ? state.dx : -state.dx) / pixelsPerFrame
        return { ...current, frames: clampFade(item, current.edge, raw) }
      })
    },
    onEnd: () => {
      const current = fadeDrag
      setFadeDrag(null)
      if (!current) return
      const field = current.edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames'
      if (current.frames !== item[field]) useEditor.getState().patchItem(item.id, { [field]: current.frames })
    },
    onClick: () => setFadeDrag(null)
  })

  // The level line on any clip that sounds — an audio clip, or a video clip carrying its own sound
  // (once detached, the sound's own clip has the line). Not offered while volume is keyframed: the
  // keys decide the level then, and a line that wrote the static field would draw nowhere.
  const volumeKeyed = Boolean(item.keyframes?.volume?.length)
  const showVolume = !blade && !trimTool && Boolean(asset?.hasAudio) && !volumeKeyed && !item.audioDetached && innerHeight >= 24
  // On a picture clip the line runs through the middle of the clip, where people click to select
  // and drag to move: an always-live strip there turned a move into a volume change. So on a video
  // track it takes the pointer only once the clip is selected — click to select, then drag the
  // line — and an audio clip, whose body is the waveform, keeps it live as editors do.
  const volumeLive = !locked && (trackKind === 'audio' || selected)
  const beginVolume = useDrag({
    threshold: 1,
    onStart: () => setVolumeDrag(item.volume),
    onMove: (state) => setVolumeDrag(volumeAtY(yForVolume(item.volume, innerHeight) + state.dy, innerHeight)),
    onEnd: (state) => {
      setVolumeDrag(null)
      const next = volumeAtY(yForVolume(item.volume, innerHeight) + state.dy, innerHeight)
      if (next !== item.volume) useEditor.getState().patchItem(item.id, { volume: next })
    },
    onClick: () => setVolumeDrag(null)
  })
  const shownVolume = volumeDrag ?? item.volume
  const keyFrames = keyFramesOf(item)

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${asset?.name ?? 'Missing media'}${item.disabled ? ' (disabled)' : ''}`}
      onPointerDown={(event) => {
        // A right-click opens the menu; it must not also start a drag.
        if (event.button !== 0) return
        onPointerDownBody(event, item)
      }}
      onContextMenu={(event) => onContextMenu(event, item)}
      style={{
        left: previewFrom * pixelsPerFrame,
        width,
        height: height - 8,
        top: 4,
        cursor: blade && !locked ? BLADE_CURSOR : undefined,
        backgroundColor: tint.body,
        borderColor: selected ? 'var(--color-accent)' : tint.edge
      }}
      aria-disabled={disabled || undefined}
      title={disabled ? 'Disabled — plays no picture or sound' : hidden ? 'On a hidden track — not in the picture' : undefined}
      className={cn(
        'group absolute overflow-hidden rounded-sm border select-none',
        locked
          ? 'cursor-not-allowed'
          : !blade &&
              // Holding ⌥ (or a trim mode armed from the menu) shows what a drag will do: the
              // timeline puts the mode on `data-trim-hint`, so no clip re-renders for it.
              'cursor-grab active:cursor-grabbing in-data-[trim-hint=slip]:cursor-ew-resize! in-data-[trim-hint=slide]:cursor-move! in-data-[trim-hint=roll]:cursor-ew-resize! in-data-[trim-hint=ripple]:cursor-col-resize!',
        selected && 'ring-1 ring-accent',
        dragging && 'z-10 opacity-85 shadow-pop',
        // Disabled (⇧E): still on the timeline, drawn and heard nowhere. A hidden track's clips
        // draw nowhere in the picture either, so they dim the same way.
        (hidden || disabled) && !dragging && 'opacity-40'
      )}
    >
      {/* The picture or the sound, under the name band. */}
      {asset && showThumbs && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute overflow-hidden rounded-xs"
          style={{ top: band, left: PICTURE_INSET, right: PICTURE_INSET, bottom: PICTURE_INSET }}
        >
          {audio ? (
            <Waveform peaks={peaks} item={item} asset={asset} fps={fps} height={pictureHeight} />
          ) : (
            <Filmstrip frames={lane} item={item} asset={asset} fps={fps} width={width - 2 * PICTURE_INSET} height={pictureHeight} />
          )}
        </div>
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

      {/* A diamond per keyed frame, any property, along the bottom edge — where the keys are,
          not what they do; the inspector says what. Not interactive, so a drag starting on one
          is still a clip drag. */}
      {keyFrames.length > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0.5 h-2">
          {keyFrames.map((frame) => (
            <span
              key={frame}
              className="absolute bottom-0 size-1.5 -translate-x-1/2 rotate-45 border border-black/50 bg-accent"
              style={{ left: frame * pixelsPerFrame }}
            />
          ))}
        </div>
      )}

      <div
        className={cn('pointer-events-none relative flex gap-1 px-1.5', band > 0 ? 'items-center' : 'h-full items-start py-1')}
        style={band > 0 ? { height: band, backgroundColor: tint.edge } : undefined}
      >
        <Icon aria-hidden="true" className={cn('size-3 shrink-0 text-on-media/70', band === 0 && 'mt-px')} />
        {/* Over a filmstrip the name gets the same dark backing as the speed badge: a text
            shadow alone left it unreadable over bright frames (white on colour bars, sky). */}
        <span
          className={cn(
            'truncate text-[11px] leading-tight font-medium text-on-media [text-shadow:0_1px_2px_rgb(0_0_0/0.65)]',
            disabled && 'line-through',
            band === 0 &&
              !audio &&
              showThumbs &&
              (asset?.kind === 'video' || asset?.kind === 'image' || asset?.kind === 'gif') &&
              '-mx-0.5 rounded-xs bg-black/55 px-0.5'
          )}
        >
          {asset?.name ?? 'Missing media'}
        </span>
        {/* Linked: this clip moves, trims and deletes with its picture or sound. Detached: the
            picture plays no sound of its own. Both are states with no other cue on the lane. */}
        {item.linkId && (
          <Link2
            role="img"
            aria-label="Linked"
            className="mt-px size-3 shrink-0 text-on-media/80"
          >
            <title>Linked — moves, trims and deletes with its {audio ? 'picture' : 'sound'}</title>
          </Link2>
        )}
        {item.audioDetached && (
          <VolumeX role="img" aria-label="Sound detached" className="mt-px size-3 shrink-0 text-on-media/80">
            <title>Sound detached — this picture plays no sound of its own</title>
          </VolumeX>
        )}
        {plainTime(item) && item.speed !== 1 && (
          <span className="ml-auto shrink-0 rounded-xs bg-black/55 px-1 text-[10px] text-on-media tabular-nums">
            {item.speed}×
          </span>
        )}
        {!plainTime(item) && (
          // Reverse and ramp read on the clip itself: an arrow for backwards, the ramp's range
          // of speeds, and in the tooltip what its sound does — the one place a silent clip is
          // otherwise only heard to be silent.
          <span
            role="img"
            aria-label={retimeBadge(item).label}
            title={retimeBadge(item).title}
            className="ml-auto shrink-0 rounded-xs bg-black/55 px-1 text-[10px] text-on-media tabular-nums"
          >
            {retimeBadge(item).text}
          </span>
        )}
      </div>

      {showVolume && (
        <div
          role="slider"
          aria-label={`Volume of ${asset?.name ?? 'clip'}`}
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={shownVolume}
          aria-valuetext={formatDb(shownVolume)}
          title={volumeLive ? `Volume ${formatDb(shownVolume)} — drag up or down` : undefined}
          onPointerDown={(event) => {
            if (!volumeLive || event.button !== 0) return
            event.stopPropagation()
            beginVolume(event)
          }}
          className={cn(
            'absolute inset-x-2 z-[1] h-2 -translate-y-1/2',
            volumeLive ? 'cursor-ns-resize' : 'pointer-events-none'
          )}
          style={{ top: yForVolume(shownVolume, innerHeight) }}
        >
          <div
            aria-hidden="true"
            className={cn(
              'absolute inset-x-0 top-1/2 h-px',
              volumeDrag !== null ? 'bg-accent' : 'bg-on-media/55 group-hover:bg-on-media/80'
            )}
          />
        </div>
      )}
      {volumeDrag !== null && (
        <span className="pointer-events-none absolute right-1 bottom-0.5 z-[2] rounded-xs bg-black/70 px-1 text-[10px] text-on-media tabular-nums">
          {formatDb(volumeDrag)}
        </span>
      )}

      {/* Fade handles: a corner square at the top, where the wedge meets the clip's top edge.
          Shown on hover and while selected, so they do not crowd an unfocused timeline. */}
      {!locked && !blade && !trimTool && width >= 24 && (
        <>
          {(['in', 'out'] as const).map((edge) => {
            const x = edge === 'in' ? Math.max(8, fadeIn) : Math.min(width - 8, width - fadeOut)
            const frames = edge === 'in' ? fadeInFrames : fadeOutFrames
            return (
              <div
                key={edge}
                role="slider"
                aria-label={edge === 'in' ? 'Fade in' : 'Fade out'}
                aria-valuemin={0}
                aria-valuemax={item.durationInFrames}
                aria-valuenow={frames}
                title={`${edge === 'in' ? 'Fade in' : 'Fade out'} ${frames}f — drag to change`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  setFadeDrag({ edge, frames: edge === 'in' ? item.fadeInFrames : item.fadeOutFrames })
                  beginFade(event)
                }}
                className={cn(
                  't-fast absolute top-0 z-[2] size-2.5 -translate-x-1/2 cursor-ew-resize rounded-xs border border-black/60 bg-on-media',
                  fadeDrag?.edge === edge || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                style={{ left: x }}
              />
            )
          })}
          {fadeDrag && (
            <span
              className="pointer-events-none absolute top-3 z-[3] -translate-x-1/2 rounded-xs bg-black/70 px-1 text-[10px] whitespace-nowrap text-on-media tabular-nums"
              style={{ left: Math.min(width - 24, Math.max(24, fadeDrag.edge === 'in' ? fadeIn : width - fadeOut)) }}
            >
              {fadeDrag.edge === 'in' ? 'Fade in' : 'Fade out'} {fadeDrag.frames}f
            </span>
          )}
        </>
      )}

      {/*
        Trim handles are 8px of hit area on a 1px-looking edge. Anything narrower and
        grabbing the edge of a clip becomes a test of mouse skill rather than an edit.
      */}
      {!locked && !blade && (
        <>
          <div
            role="presentation"
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDownTrim(event, item, 'start')
            }}
            title={trimTool ? undefined : 'Drag to trim the start. ⌥-drag rolls this cut.'}
            className={TRIM_HANDLE_CLASS + ' left-0'}
          />
          <div
            role="presentation"
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDownTrim(event, item, 'end')
            }}
            title={trimTool ? undefined : 'Drag to trim the end. ⌥-drag rolls this cut.'}
            className={TRIM_HANDLE_CLASS + ' right-0'}
          />
        </>
      )}
    </div>
  )
}

/** Every frame, item-relative and inside the clip, that holds a key of any property. */
function keyFramesOf(item: Item): number[] {
  if (!item.keyframes) return []
  const frames = new Set<number>()
  for (const list of Object.values(item.keyframes)) {
    for (const key of list ?? []) {
      if (key.frame >= 0 && key.frame <= item.durationInFrames) frames.add(key.frame)
    }
  }
  return [...frames].sort((a, b) => a - b)
}

/**
 * Memoised because the timeline re-renders on every selection change and every zoom step,
 * and a clip that recomputes its filmstrip mapping each time is the difference between a
 * responsive drag and a sticky one on a project with a hundred clips.
 */
export const Clip = memo(ClipImpl)
