/**
 * `frame_grid` — a stretch of the edit as one labelled contact sheet.
 *
 * Every cell is a `renderFrame` still, the path `preview_frame` and the exporter's picture share,
 * so a grid can never show an edit that differs from what the file will hold. A file on its own
 * is shown through the same path by rendering a one-clip timeline of it, rather than a second
 * decoder in main: bay's ffmpeg could tile the frames but not label them (no `drawtext`), and a
 * second route to "what does this source look like" is a second answer to keep in agreement.
 *
 * Labels sit in a strip under each picture, never over it — the corner of a frame is exactly
 * where a caption or a logo that is being checked would be.
 */

import { cellWait, DEFAULT_GRID_CELLS, gridFrames, gridLayout, LABEL_HEIGHT, MAX_GRID_CELLS, spokenAround } from '@shared/frame-grid'
import { findAsset, formatTimecode, itemsAtFrame, sourceTimeAt, timelineDuration, US_PER_SECOND, type Asset, type Project, type Timeline } from '@shared/project'
import type { TranscriptSegment } from '@shared/transcribe'
import { DEFAULT_SOURCE_TIMEOUT_MS, MediaPool, renderFrame } from '@/engine'
import { fail, project, resolveAsset, timeline, type Handlers } from './helpers'
import { anyTranscriptFor } from './transcribe'

const GRID_TIMELINE_ID = 'frame-grid'

/** A transcript this session already has for `path`, in whatever language and by whatever model. */
function transcriptOf(path: string | null): readonly TranscriptSegment[] | null {
  if (!path) return null
  return anyTranscriptFor(path)?.segments ?? null
}

interface Cell {
  frame: number
  timecode: string
  /** Words being said at this moment, or '' when nothing is (or nothing has been transcribed). */
  words: string
}

/** A timeline that plays `asset` once from its first frame, full frame, and nothing else. */
function sourceTimeline(asset: Asset, fps: number): Timeline {
  const width = asset.width ?? 1920
  const height = asset.height ?? 1080
  return {
    id: GRID_TIMELINE_ID,
    name: asset.name,
    fps,
    width,
    height,
    background: '#000000',
    tracks: [
      {
        id: 'frame-grid-v1',
        kind: 'video',
        name: 'V1',
        locked: false,
        muted: true,
        hidden: false,
        items: [
          {
            id: 'frame-grid-item',
            assetId: asset.id,
            trackId: 'frame-grid-v1',
            from: 0,
            durationInFrames: Math.max(1, Math.ceil((asset.durationUs / US_PER_SECOND) * fps)),
            sourceStartUs: 0,
            layout: { left: 0, top: 0, width, height, opacity: 1, rotation: 0 },
            volume: 0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            speed: 1
          }
        ]
      }
    ]
  }
}

function countOf(args: Record<string, unknown>): number {
  const given = args['count']
  if (given === undefined) return DEFAULT_GRID_CELLS
  const n = Math.round(Number(given))
  if (!Number.isFinite(n) || n < 1) fail(`count must be between 1 and ${MAX_GRID_CELLS}; got ${JSON.stringify(given)}.`)
  return Math.min(MAX_GRID_CELLS, n)
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const given = args[key]
  if (given === undefined) return undefined
  const n = Number(given)
  if (!Number.isFinite(n) || n < 0) fail(`${key} must be a number of at least 0; got ${JSON.stringify(given)}.`)
  return n
}

/** What to render: the project and timeline the stills come from, and each cell's frame and label. */
function plan(args: Record<string, unknown>): { source: Project; tl: Timeline; cells: Cell[]; describe: string } {
  const count = countOf(args)
  const assetId = typeof args['assetId'] === 'string' ? args['assetId'] : null

  if (assetId) {
    const asset = resolveAsset(assetId)
    if (asset.kind !== 'video' || !asset.hasVideo || !asset.path) {
      fail(`"${asset.name}" is not a video file, so it has no frames to lay out. Leave out assetId to see the timeline.`)
    }
    const fps = asset.fps && asset.fps > 0 ? asset.fps : 30
    const tl = sourceTimeline(asset, fps)
    const last = Math.max(0, tl.tracks[0]!.items[0]!.durationInFrames - 1)
    const fromSeconds = numberArg(args, 'fromSeconds') ?? 0
    const toSeconds = numberArg(args, 'toSeconds')
    const from = Math.min(last, Math.round(fromSeconds * fps))
    const to = toSeconds === undefined ? last : Math.min(last, Math.round(toSeconds * fps))
    if (to < from) fail(`toSeconds (${toSeconds}) is before fromSeconds (${fromSeconds}).`)
    const segments = transcriptOf(asset.path)
    const frames = gridFrames(from, to, count)
    const half = halfWindow(frames, fps)
    const cells = frames.map((frame) => ({
      frame,
      timecode: formatTimecode(frame, fps, true),
      words: segments ? spokenAround(segments, frame / fps, half) : ''
    }))
    return {
      source: { ...project(), timelines: [tl], activeTimelineId: tl.id },
      tl,
      cells,
      describe: `"${asset.name}" from ${(from / fps).toFixed(2)}s to ${(to / fps).toFixed(2)}s`
    }
  }

  const tl = timeline()
  const duration = timelineDuration(tl)
  if (duration === 0) fail('The timeline is empty, so there is nothing to lay out. Pass assetId to look at a file.')
  const fromFrame = numberArg(args, 'fromFrame')
  const toFrame = numberArg(args, 'toFrame')
  const from = Math.min(duration - 1, Math.round(fromFrame ?? 0))
  const to = Math.min(duration - 1, Math.round(toFrame ?? duration - 1))
  if (to < from) fail(`toFrame (${toFrame}) is before fromFrame (${fromFrame}). The timeline runs 0–${duration - 1}.`)
  const current = project()
  const frames = gridFrames(from, to, count)
  const half = halfWindow(frames, tl.fps)
  const cells = frames.map((frame) => ({
    frame,
    timecode: `${formatTimecode(frame, tl.fps, true)} · f${frame}`,
    words: wordsOnTimeline(current, tl, frame, half)
  }))
  return { source: current, tl, cells, describe: `timeline frames ${from}–${to}` }
}

/** Half the gap between cells, in seconds, bounded so a sparse grid still names one moment's words. */
function halfWindow(frames: readonly number[], fps: number): number {
  const gap = frames.length > 1 ? (frames[1]! - frames[0]!) / fps : 1
  return Math.min(1, Math.max(0.25, gap / 2))
}

/** What is being said at `frame`: the first sounding clip there whose source has a transcript. */
function wordsOnTimeline(current: Project, tl: Timeline, frame: number, half: number): string {
  for (const item of itemsAtFrame(tl, frame)) {
    const asset = findAsset(current, item.assetId)
    if (!asset?.hasAudio || item.audioDetached) continue
    const segments = transcriptOf(asset.path)
    if (!segments) continue
    const words = spokenAround(segments, sourceTimeAt(item, frame, tl.fps) / US_PER_SECOND, half)
    if (words) return words
  }
  return ''
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = dataUrl
  return image.decode().then(() => image)
}

/** `text` cut to fit `width` with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** The sentence for cells that do not show what an export would: late ones first, since nothing else names them. */
function gridWarning(incomplete: readonly { missing: string[]; late?: true }[], total: number, late: number): string {
  const missing = [...new Set(incomplete.flatMap((c) => c.missing))]
  const parts: string[] = []
  if (late > 0) {
    parts.push(
      `${late} of ${total} cells were drawn without waiting for their media, because the grid ran out of time ` +
        '— they may show black or stale pictures. Ask for fewer cells (count) or a shorter stretch.'
    )
  }
  const short = incomplete.length - late
  if (short > 0) {
    parts.push(
      `${short} of ${total} cells are missing items (${missing.join(', ') || 'unnamed'}), so those cells do not show what an export would. ` +
        'Call frame_grid again in a moment if media was loading, or check browse_assets.'
    )
  }
  return parts.join(' ')
}

export async function frameGrid(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { source, tl, cells, describe } = plan(args)
  const layout = gridLayout(cells.length, tl.width / Math.max(1, tl.height))

  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) fail('This window has no 2D canvas to compose the grid with.')
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, layout.width, layout.height)

  // One pool for every cell: the grid owns it and nothing else draws from it, and a pool per
  // cell would open every video again for each of up to 36 stills.
  const pool = new MediaPool({ maxVideoElements: 8 })
  const incomplete: { frame: number; missing: string[]; late?: true }[] = []
  const textWarnings = new Set<string>()
  // One deadline for the whole grid: 36 cells each allowed the full per-source wait would outlast
  // the tool's own timeout, and the caller would get nothing instead of a grid with gaps marked.
  const began = performance.now()
  let late = 0
  try {
    for (const [index, cell] of cells.entries()) {
      const x = (index % layout.columns) * layout.cellWidth
      const y = Math.floor(index / layout.columns) * (layout.cellHeight + LABEL_HEIGHT)
      const wait = cellWait(performance.now() - began, DEFAULT_SOURCE_TIMEOUT_MS)
      let still
      try {
        still = await renderFrame({
          project: source,
          timelineId: tl.id,
          frame: cell.frame,
          maxSize: Math.max(layout.cellWidth, layout.cellHeight),
          format: 'png',
          pool,
          timeoutMs: wait.timeoutMs
        })
      } catch (error) {
        fail(`Frame ${cell.frame} could not be rendered: ${error instanceof Error ? error.message : String(error)}`)
      }
      ctx.drawImage(await loadImage(still.dataUrl), x, y, layout.cellWidth, layout.cellHeight)
      if (wait.late) {
        late++
        incomplete.push({ frame: cell.frame, missing: still.unresolved, late: true })
      } else if (still.pending > 0 || still.placeholders > 0) {
        incomplete.push({ frame: cell.frame, missing: still.unresolved })
      }
      for (const t of still.textFits ?? []) {
        if (t.clipped) textWarnings.add(`${t.itemId}: cut off — does not fit its box.`)
        else if (!t.fontAvailable) textWarnings.add(`${t.itemId}: its font is not installed, so another was substituted.`)
      }

      // The label strip.
      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y + layout.cellHeight, layout.cellWidth, LABEL_HEIGHT)
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#FFFFFF'
      ctx.font = '600 14px ui-monospace, Menlo, monospace'
      ctx.fillText(fit(ctx, cell.timecode, layout.cellWidth - 12), x + 6, y + layout.cellHeight + 3)
      if (cell.words) {
        ctx.fillStyle = '#FFD60A'
        ctx.font = '500 14px -apple-system, system-ui, sans-serif'
        ctx.fillText(fit(ctx, `“${cell.words}”`, layout.cellWidth - 12), x + 6, y + layout.cellHeight + 21)
      }
      // A hairline between cells, so two similar frames do not read as one wide picture.
      ctx.strokeStyle = '#333333'
      ctx.strokeRect(x + 0.5, y + 0.5, layout.cellWidth - 1, layout.cellHeight + LABEL_HEIGHT - 1)
    }
    const image = canvas.toDataURL('image/jpeg', 0.82)
    const labelled = cells.filter((c) => c.words).length
    return {
      source: describe,
      cells: cells.map((c) => ({ frame: c.frame, timecode: c.timecode, ...(c.words ? { words: c.words } : {}) })),
      layout: { columns: layout.columns, rows: layout.rows, width: layout.width, height: layout.height },
      image,
      ...(labelled === 0 ? { words: 'No transcript is cached for these sources this session — call transcribe on the clip to label the cells with what is said.' } : {}),
      ...(textWarnings.size > 0 ? { textWarnings: [...textWarnings] } : {}),
      ...(incomplete.length > 0 ? { incomplete, warning: gridWarning(incomplete, cells.length, late) } : {})
    }
  } finally {
    pool.dispose()
    canvas.width = 0
    canvas.height = 0
  }
}

export const handlers: Handlers = {
  frame_grid: (args) => frameGrid(args)
}
