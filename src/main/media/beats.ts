/**
 * Beat detection for a media file: ffmpeg decodes it to mono float PCM at the analysis rate,
 * `beat-analysis.ts` does the work, and the grid is cached beside the waveform peaks under the
 * same content key — so a second call on an unchanged file is a JSON read.
 *
 * The analysis lives in its own module because this one reaches `electron` through the cache
 * paths; everything that decides a beat is testable without it.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BEAT_ANALYSIS_VERSION, type BeatGrid } from '@shared/beats'
import { ffmpegBin, runBinary } from '../ffmpeg/ffmpeg'
import { analyzeBeats, ANALYSIS_SAMPLE_RATE, type BeatAnalysis } from './beat-analysis'
import { peaksDir } from './cache-dirs'
import { cacheKey, stampOf } from './cache-key'
import { noteCacheHit, scheduleCacheUpkeep } from './cache-upkeep'
import { once, withSlot } from './queue'

export interface DetectOptions {
  beatsPerBar?: number
}

const toUs = (seconds: number): number => Math.round(seconds * 1_000_000)

export function gridFromAnalysis(analysis: BeatAnalysis): BeatGrid {
  return {
    version: BEAT_ANALYSIS_VERSION,
    bpm: analysis.bpm,
    confidence: analysis.confidence,
    beatsPerBar: analysis.beatsPerBar,
    beatsUs: analysis.beats.map(toUs),
    downbeatsUs: analysis.downbeats.map(toUs),
    downbeatConfidence: analysis.downbeatConfidence,
    dropouts: analysis.dropouts.map((d) => ({ startUs: toUs(d.start), endUs: toUs(d.end), kind: d.kind }))
  }
}

export async function detectBeats(path: string, options: DetectOptions = {}): Promise<BeatGrid> {
  const beatsPerBar = Math.max(1, Math.min(12, Math.round(options.beatsPerBar ?? 4)))
  const stamp = await stampOf(path)
  const key = cacheKey(stamp, 'beats', BEAT_ANALYSIS_VERSION, beatsPerBar)
  const cached = join(peaksDir(), `${key}.json`)

  return once(key, async () => {
    try {
      const parsed = JSON.parse(await readFile(cached, 'utf8')) as BeatGrid
      if (parsed.version === BEAT_ANALYSIS_VERSION && Array.isArray(parsed.beatsUs)) {
        noteCacheHit(key, cached)
        return parsed
      }
    } catch {
      // No cache, or a truncated one from a crash mid-write. Either way, analyse.
    }

    const pcm = await withSlot(() =>
      runBinary(ffmpegBin(), [
        '-nostdin',
        '-v',
        'error',
        '-i',
        stamp.path,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(ANALYSIS_SAMPLE_RATE),
        '-f',
        'f32le',
        '-'
      ])
    )
    // A Buffer's bytes may sit at an offset that is not a multiple of 4 in its pool; copy
    // rather than view, or the Float32Array constructor throws on the alignment.
    const samples = new Float32Array(pcm.length >> 2)
    for (let i = 0; i < samples.length; i += 1) samples[i] = pcm.readFloatLE(i * 4)

    const grid = gridFromAnalysis(analyzeBeats(samples, ANALYSIS_SAMPLE_RATE, { beatsPerBar }))
    const temp = `${cached}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(grid))
    await rename(temp, cached)
    noteCacheHit(key, cached)
    scheduleCacheUpkeep()
    return grid
  })
}
