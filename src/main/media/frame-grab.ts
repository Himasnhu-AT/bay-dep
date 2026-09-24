/**
 * One exact source frame, grabbed to a PNG — the picture of a freeze frame.
 *
 * **Which frame is the whole problem.** The compositor seeks a `<video>` to `sourceSecondsAt` and
 * the element shows the last frame whose timestamp is at or before that time. ffmpeg's accurate
 * `-ss` does the opposite: it drops frames *before* the time and outputs the first one at or
 * after it — the next frame whenever the time falls between two, which it almost always does
 * (`FRAME_EDGE_SECONDS` puts it half a millisecond past a frame on purpose). A freeze one frame
 * late is a visible jump at the cut into it.
 *
 * So the frame is chosen first, from the packets' timestamps (ffprobe reads them without
 * decoding), and ffmpeg is then seeked to the midpoint between that frame and the one before —
 * where "first frame at or after" and "last frame at or before" name the same frame.
 *
 * Kept free of Electron (`freeze-frame.ts` supplies the folder) so the choice and the grab run
 * under `pnpm test` against the real binaries.
 */

import { createHash } from 'node:crypto'
import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from '../ffmpeg/ffmpeg'

/** Timestamps within this of the asked time count as at it — well under a microsecond of float noise. */
const TOLERANCE_SECONDS = 1e-6

/**
 * The frame an element seeked to `seconds` shows, among `frameSeconds` (start-relative
 * timestamps, any order), and where to seek ffmpeg so its first output is that frame. Null when
 * there are no frames.
 */
export function chooseFrame(
  frameSeconds: readonly number[],
  seconds: number
): { frameSeconds: number; seekSeconds: number } | null {
  const times = [...new Set(frameSeconds.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b)
  const first = times[0]
  if (first === undefined) return null
  let index = 0
  for (let i = 0; i < times.length; i += 1) {
    if (times[i]! <= seconds + TOLERANCE_SECONDS) index = i
    else break
  }
  const frame = times[index]!
  const previous = index > 0 ? times[index - 1]! : null
  // Before the first frame an element shows the first frame, and so does a seek to 0.
  const seek = previous === null ? Math.max(0, Math.min(frame, first) - 0.001) : (previous + frame) / 2
  return { frameSeconds: frame, seekSeconds: Math.max(0, seek) }
}

interface ProbedFrames {
  frameSeconds: number[]
  /** The stream's tagged matrix, or null when it carries none. */
  colorSpace: string | null
}

/** Packet timestamps of the first video stream around `seconds`, relative to the file's start. */
async function probeFrames(ffprobe: string, path: string, seconds: number): Promise<ProbedFrames> {
  const from = Math.max(0, seconds - 3)
  const { stdout } = await run(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-read_intervals', `${from.toFixed(6)}%${(seconds + 1).toFixed(6)}`,
    '-show_entries', 'packet=pts_time:stream=color_space:format=start_time',
    '-of', 'json',
    path
  ])
  const parsed = JSON.parse(stdout) as {
    packets?: { pts_time?: string }[]
    streams?: { color_space?: string }[]
    format?: { start_time?: string }
  }
  const start = Number(parsed.format?.start_time ?? 0)
  const origin = Number.isFinite(start) ? start : 0
  const frameSeconds = (parsed.packets ?? [])
    .map((packet) => Number(packet.pts_time))
    .filter((t) => Number.isFinite(t))
    .map((t) => t - origin)
  const tagged = parsed.streams?.[0]?.color_space
  return { frameSeconds, colorSpace: tagged && tagged !== 'unknown' ? tagged : null }
}

/**
 * The YUV→RGB step. A stream that names its matrix is converted by it; an untagged one is taken
 * as BT.709, which is what Chromium assumes and what bay's own exports are tagged — swscale's
 * default for an untagged stream is BT.601, whose greens and reds differ visibly from the moving
 * clip the freeze sits next to.
 */
export function colourFilter(colorSpace: string | null): string {
  const matrix = colorSpace === null ? 'bt709' : 'auto'
  return `scale=in_color_matrix=${matrix}:in_range=auto,format=rgb24`
}

export function grabArgs(path: string, seekSeconds: number, colorSpace: string | null, out: string): string[] {
  return [
    '-nostdin', '-v', 'error',
    '-ss', seekSeconds.toFixed(6),
    '-i', path,
    '-map', '0:v:0',
    '-frames:v', '1',
    '-vf', colourFilter(colorSpace),
    '-c:v', 'png',
    '-f', 'image2',
    '-y', out
  ]
}

export type GrabResult = { ok: true; path: string; frameSeconds: number } | { ok: false; error: string }

/**
 * Grabs the frame shown at `seconds` of `path` into `dir` as `<slug>-<hash>.png`, named by the
 * PNG's own bytes — the same frame twice is one file.
 */
export async function grabFrame(
  tools: { ffmpeg: string; ffprobe: string },
  path: string,
  seconds: number,
  dir: string,
  name: string
): Promise<GrabResult> {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { ok: false, error: `${seconds} is not a time in the source; a freeze frame needs a time of 0 seconds or more.` }
  }
  let probed: ProbedFrames
  try {
    probed = await probeFrames(tools.ffprobe, path, seconds)
  } catch (error) {
    return { ok: false, error: `Could not read the frames of ${name}: ${(error as Error).message}` }
  }
  const choice = chooseFrame(probed.frameSeconds, seconds)
  if (!choice) {
    return { ok: false, error: `${name} has no picture at ${seconds.toFixed(3)}s to freeze.` }
  }
  const slug = `freeze-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'freeze'
  const scratch = join(dir, `.${slug}-${process.pid}-${Date.now()}.png`)
  try {
    await run(tools.ffmpeg, grabArgs(path, choice.seekSeconds, probed.colorSpace, scratch))
    const bytes = await readFile(scratch)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    const final = join(dir, `${slug}-${hash}.png`)
    await rename(scratch, final)
    return { ok: true, path: final, frameSeconds: choice.frameSeconds }
  } catch (error) {
    await rm(scratch, { force: true })
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'ffmpeg wrote no frame' : (error as Error).message
    return { ok: false, error: `Could not grab the frame of ${name} at ${seconds.toFixed(3)}s: ${reason}.` }
  }
}
