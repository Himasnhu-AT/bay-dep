/**
 * Scene cuts in a video file: ffmpeg's `scdet`, passing only the frames it marks as a change,
 * printed to stdout by `metadata`.
 *
 * stdout rather than scdet's own log lines, because `run` keeps only the tail of stderr — a
 * long film's early cuts would be cut off the front of the log — and stdout is kept whole.
 * The picture is scaled down first: scdet compares whole frames, and a 4K frame answers
 * "is this a new shot" no better than a 320-pixel one at a fraction of the cost.
 *
 * Pure Node — no Electron — so the parse and the real binary run under `pnpm test`.
 */

import { clampCutThreshold, DEFAULT_CUT_THRESHOLD, type SceneCut } from '@shared/ipc'
import { ffmpegBin, run } from '../ffmpeg/ffmpeg'
import { withSlot } from './queue'

export { DEFAULT_CUT_THRESHOLD }

/** The filter graph. Its filter names are asked of the vendored binary by `capabilities.test.ts`. */
export function sceneCutFilter(threshold: number): string {
  const t = clampCutThreshold(threshold)
  return `scale=320:-2,scdet=threshold=${t}:sc_pass=1,metadata=mode=print:file=-`
}

export function sceneCutArgs(path: string, threshold: number = DEFAULT_CUT_THRESHOLD): string[] {
  return [
    '-nostdin', '-v', 'error',
    '-i', path,
    '-map', '0:v:0',
    '-an', '-sn', '-dn',
    '-vf', sceneCutFilter(threshold),
    '-f', 'null', '-'
  ]
}

/**
 * `metadata=print` output → cuts. Each passed frame prints a `frame:… pts_time:…` line followed
 * by its keys; the time is scdet's own `lavfi.scd.time`, falling back to the frame's `pts_time`.
 */
export function parseSceneCuts(stdout: string): SceneCut[] {
  const cuts: SceneCut[] = []
  let current: { time: number | null; score: number | null } | null = null
  const flush = (): void => {
    if (current && current.time !== null && Number.isFinite(current.time)) {
      cuts.push({ us: Math.round(current.time * 1_000_000), score: Math.round((current.score ?? 0) * 1000) / 1000 })
    }
  }
  for (const line of stdout.split('\n')) {
    const frame = /^frame:\s*\d+.*pts_time:\s*(-?[\d.]+)/.exec(line)
    if (frame) {
      flush()
      current = { time: Number(frame[1]), score: null }
      continue
    }
    if (!current) continue
    const key = /^lavfi\.scd\.(time|score)=(-?[\d.]+)/.exec(line.trim())
    if (key) {
      if (key[1] === 'time') current.time = Number(key[2])
      else current.score = Number(key[2])
    }
  }
  flush()
  // The first frame of a file is never a cut, whatever scdet scores it.
  return cuts.filter((cut) => cut.us > 0).sort((a, b) => a.us - b.us)
}

export async function detectSceneCuts(path: string, threshold: number = DEFAULT_CUT_THRESHOLD): Promise<SceneCut[]> {
  const { stdout } = await withSlot(() => run(ffmpegBin(), sceneCutArgs(path, threshold)))
  return parseSceneCuts(stdout)
}
