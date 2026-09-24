/**
 * ffprobe, turned into the one shape the rest of bay agrees on.
 *
 * ffprobe's JSON is deliberately unopinionated: durations appear in three places and
 * disagree, frame rates are rationals, and half the fields are absent for any given file.
 * Every one of those decisions is made here so nothing downstream has to make it twice.
 */

import type { ProbeResult } from '@shared/ipc'
import { US_PER_SECOND } from '@shared/project'
import { ffprobeBin, run } from './ffmpeg'

export interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  duration?: string
  sample_rate?: string
  channels?: number
  nb_frames?: string
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

export interface FfprobeFormat {
  format_name?: string
  duration?: string
  bit_rate?: string
}

export interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

/**
 * `r_frame_rate` is a rational string — `30000/1001`, not `29.97`. `Number('30000/1001')` is
 * NaN, and a NaN fps propagates into every frame conversion downstream as a silently empty
 * timeline, so it is parsed rather than coerced.
 */
export function parseRational(value: string | undefined): number | null {
  if (!value) return null
  const slash = value.indexOf('/')
  if (slash === -1) {
    const direct = Number(value)
    return Number.isFinite(direct) && direct > 0 ? direct : null
  }
  // No guard on the denominator or on either side being numeric: the finite-and-positive
  // check below already covers every one of those. `0/0` and `N/A` divide to NaN, `1/0` to
  // Infinity, `0/1` and `-30/1` to values that are not positive. Established by mutation —
  // removing the guards changed no result over the handwritten cases plus 20,000 generated
  // ones — and they are gone rather than kept, because a branch no test can falsify is a
  // branch nobody can safely change later.
  const fps = Number(value.slice(0, slash)) / Number(value.slice(slash + 1))
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

function seconds(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Round a rate for display: 29.97 rather than 29.970029970029972. */
function prettyFps(fps: number): string {
  const rounded = Math.round(fps * 100) / 100
  return String(rounded)
}

function prettyDuration(us: number): string {
  const total = Math.round(us / US_PER_SECOND)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobeBin(), [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path
  ])

  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput
  } catch {
    throw new Error(`ffprobe returned output that is not JSON for ${path}`)
  }

  return shapeProbe(parsed, path)
}

/**
 * Turns ffprobe's JSON into bay's shape. Separated from the spawn so it can be tested against
 * recorded output from real files — which is the only way to cover the cases that matter here,
 * because they are all *shapes of real media* (an audio stream with no frame rate, a still with
 * no duration, a file with no video at all) rather than behaviours of ffprobe.
 */
export function shapeProbe(parsed: FfprobeOutput, path: string): ProbeResult {
  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  // A still image probes as a video stream with one frame and no duration; it must not be
  // mistaken for a zero-length video, because an item placed from it has to be stretchable.
  const stillImage =
    video !== undefined &&
    audio === undefined &&
    (video.nb_frames === '1' || video.disposition?.attached_pic === 1) &&
    seconds(parsed.format?.duration) === null

  const durationSeconds =
    seconds(parsed.format?.duration) ??
    seconds(video?.duration) ??
    seconds(audio?.duration) ??
    (stillImage ? 0 : null)

  if (durationSeconds === null && !stillImage && streams.length === 0) {
    throw new Error(`ffprobe found no media streams in ${path}`)
  }

  const durationUs = Math.max(0, Math.round((durationSeconds ?? 0) * US_PER_SECOND))
  const fps = parseRational(video?.r_frame_rate) ?? parseRational(video?.avg_frame_rate)

  const parts: string[] = []
  if (video?.codec_name) parts.push(video.codec_name)
  if (audio?.codec_name) parts.push(audio.codec_name)
  if (video?.width && video.height) parts.push(`${video.width}×${video.height}`)
  if (fps !== null && !stillImage) parts.push(`${prettyFps(fps)}fps`)
  if (!video && audio?.sample_rate) {
    const khz = Math.round(Number(audio.sample_rate) / 100) / 10
    parts.push(`${khz}kHz`)
    if (audio.channels) parts.push(audio.channels === 1 ? 'mono' : `${audio.channels}ch`)
  }
  if (durationUs > 0) parts.push(prettyDuration(durationUs))
  if (parts.length === 0) parts.push(parsed.format?.format_name ?? 'unknown')

  return {
    path,
    durationUs,
    width: video?.width ?? null,
    height: video?.height ?? null,
    // A still has no meaningful rate; reporting 25fps because the container said so would
    // make the importer treat it as a one-frame video.
    fps: stillImage ? null : fps,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    ...(audio?.channels && audio.channels > 0 ? { channels: audio.channels } : {}),
    summary: parts.join(' · ')
  }
}
