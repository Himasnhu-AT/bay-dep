/**
 * The arithmetic of `frame_grid`: which frames, how they tile, and what was being said at each.
 *
 * One picture of a dozen moments is how an agent watches its own edit — "done means watched".
 * A single `preview_frame` answers "is this frame right"; a grid answers "does the B-roll cover
 * the line it was cut for", "does the caption land on the word", "is there a black flash
 * between these two shots". The picture is composed in the renderer (bay's ffmpeg has no
 * `drawtext`, and the frames already come from the preview renderer); what is here is pure, so
 * the sampling and the layout are held still by tests rather than by looking.
 */

import type { TranscriptSegment } from './transcribe'

export const DEFAULT_GRID_CELLS = 12
export const MAX_GRID_CELLS = 36
/** The whole grid's longest edge. Past this a client downsizes it anyway, and the labels go first. */
export const MAX_GRID_EDGE = 2048
/** Height of the caption strip under each cell: a timecode line and a words line. */
export const LABEL_HEIGHT = 40

/** The `frame_grid` tool's timeout: past it the caller gets no grid at all. */
export const GRID_TOOL_TIMEOUT_MS = 3 * 60_000
/** When cells stop waiting for sources, leaving the rest of the tool's time to compose and answer. */
export const GRID_DEADLINE_MS = GRID_TOOL_TIMEOUT_MS - 30_000
/**
 * How many times over one still can wait its per-source timeout: up to three draw attempts, each
 * a media wait, a settle, a second media wait and a readiness wait, and a metadata wait per clip
 * inside the media waits. Generous on purpose; dividing by it keeps a cell started before the
 * deadline from running far past it.
 */
const WAITS_PER_STILL = 16

/**
 * How long the next cell may wait on each source, `elapsedMs` into the grid. Past the deadline it
 * waits not at all (`timeoutMs: 0`: it draws whatever has loaded) and is `late` — the grid marks it
 * incomplete rather than letting the whole call run out and return nothing.
 */
export function cellWait(elapsedMs: number, perSourceMs: number, deadlineMs: number = GRID_DEADLINE_MS): { timeoutMs: number; late: boolean } {
  const remaining = deadlineMs - elapsedMs
  if (remaining <= 0) return { timeoutMs: 0, late: true }
  return { timeoutMs: Math.max(0, Math.min(perSourceMs, Math.floor(remaining / WAITS_PER_STILL))), late: false }
}

/**
 * `count` frames spread over the inclusive range `[from, to]`, each the middle of an equal slice
 * — never both ends, which are usually the frame either side of a cut and tell nothing. Distinct
 * and ascending: a range shorter than `count` gives one cell per frame.
 */
export function gridFrames(from: number, to: number, count: number): number[] {
  const lo = Math.round(Math.min(from, to))
  const hi = Math.round(Math.max(from, to))
  const span = hi - lo + 1
  const n = Math.max(1, Math.min(Math.round(count), MAX_GRID_CELLS, span))
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    const frame = lo + Math.floor(((i + 0.5) * span) / n)
    if (out[out.length - 1] !== frame) out.push(frame)
  }
  return out
}

export interface GridLayout {
  columns: number
  rows: number
  /** One cell's picture, in pixels. */
  cellWidth: number
  cellHeight: number
  /** The whole image, labels included. */
  width: number
  height: number
}

/**
 * Columns and cell size for `cells` pictures of `aspect` (width / height), under MAX_GRID_EDGE on
 * both sides. The column count is the one that makes the whole image closest to 4:3 — wide
 * enough to read a row as a sequence, square enough that a client does not shrink it to a strip.
 */
export function gridLayout(cells: number, aspect: number, maxEdge: number = MAX_GRID_EDGE): GridLayout {
  const n = Math.max(1, Math.round(cells))
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  let best = { columns: 1, score: Infinity }
  for (let columns = 1; columns <= n; columns += 1) {
    const rows = Math.ceil(n / columns)
    // Shape of the image at an arbitrary cell width of 100.
    const ratio = (columns * 100) / (rows * (100 / a + LABEL_HEIGHT))
    const score = Math.abs(Math.log(ratio / (4 / 3))) + (columns * rows - n) * 0.05
    if (score < best.score) best = { columns, score }
  }
  const columns = best.columns
  const rows = Math.ceil(n / columns)
  // The widest cell that keeps both edges inside the bound.
  const byWidth = Math.floor(maxEdge / columns)
  const byHeight = Math.floor(((maxEdge / rows - LABEL_HEIGHT) * a))
  const cellWidth = Math.max(16, Math.min(byWidth, byHeight, 640))
  const cellHeight = Math.max(9, Math.round(cellWidth / a))
  return { columns, rows, cellWidth, cellHeight, width: columns * cellWidth, height: rows * (cellHeight + LABEL_HEIGHT) }
}

/**
 * The words spoken within `halfWindow` seconds either side of `seconds` in a source's transcript,
 * as one line. Word times when whisper gave them; otherwise the whole line whose span holds the
 * moment. Empty when nothing is being said.
 */
export function spokenAround(
  segments: readonly TranscriptSegment[],
  seconds: number,
  halfWindow: number,
  maxWords = 10
): string {
  const lo = seconds - halfWindow
  const hi = seconds + halfWindow
  const words: string[] = []
  for (const segment of segments) {
    if (segment.endSeconds < lo || segment.startSeconds > hi) continue
    if (segment.words && segment.words.length > 0) {
      for (const word of segment.words) {
        if (word.endSeconds >= lo && word.startSeconds <= hi) words.push(word.text)
      }
    } else if (segment.startSeconds <= seconds && segment.endSeconds >= seconds) {
      words.push(...segment.text.trim().split(/\s+/).filter(Boolean))
    }
  }
  if (words.length <= maxWords) return words.join(' ')
  // Centred on the moment rather than the first words of a long line.
  const start = Math.floor((words.length - maxWords) / 2)
  return `…${words.slice(start, start + maxWords).join(' ')}…`
}
