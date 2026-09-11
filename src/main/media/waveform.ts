/**
 * Peak extraction for drawing waveforms.
 *
 * ffmpeg decodes to mono s16le at a low rate and the peaks are reduced here. The rate is the
 * whole trick: a waveform is a picture a few hundred pixels wide, so decoding at 48 kHz means
 * throwing away 99% of the samples after paying to produce them. 8 kHz keeps every transient
 * a bucket could show and costs 16 KB a second to carry.
 */

import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { peaksDir } from '../paths'
import { ffmpegBin, runBinary } from './ffmpeg'
import { cacheKey, stampOf } from './cache-key'
import { once, withSlot } from './queue'
import { probe } from './probe'
import { noteCacheHit, scheduleCacheUpkeep } from './cache-upkeep'

const SAMPLE_RATE = 8000

function reduceToPeaks(pcm: Buffer, buckets: number): number[] {
  const sampleCount = Math.floor(pcm.length / 2)
  const out = new Array<number>(buckets).fill(0)
  if (sampleCount === 0) return out

  const perBucket = sampleCount / buckets
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * perBucket)
    const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((bucket + 1) * perBucket)))
    let peak = 0
    for (let i = start; i < end; i += 1) {
      const sample = Math.abs(pcm.readInt16LE(i * 2))
      if (sample > peak) peak = sample
    }
    // 32768, not 32767: Int16 is asymmetric and a single full-scale negative sample would
    // otherwise produce a peak slightly above 1 and clip the drawing.
    out[bucket] = Math.min(1, peak / 32768)
  }
  return out
}

export async function waveform(
  _assetId: string,
  path: string,
  buckets: number
): Promise<number[]> {
  const count = Math.max(1, Math.min(20000, Math.round(buckets)))
  const stamp = await stampOf(path)
  const key = cacheKey(stamp, 'peaks', count, SAMPLE_RATE)
  const cached = join(peaksDir(), `${key}.json`)

  return once(key, async () => {
    try {
      const text = await readFile(cached, 'utf8')
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed) && parsed.length === count) {
        noteCacheHit(key, cached)
        return parsed as number[]
      }
    } catch {
      // No cache, or a truncated one from a crash mid-write. Either way, regenerate.
    }

    let pcm: Buffer
    try {
      pcm = await withSlot(() =>
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
          String(SAMPLE_RATE),
          '-f',
          's16le',
          '-'
        ])
      )
    } catch (error) {
      // ffmpeg fails outright when asked for audio a file does not have. A silent file is
      // not a broken one, so it gets a flat waveform; anything else is a real failure and
      // has to surface with ffmpeg's own words.
      const info = await probe(stamp.path).catch(() => null)
      if (info && !info.hasAudio) return new Array<number>(count).fill(0)
      throw error
    }

    const peaks = reduceToPeaks(pcm, count)
    const temp = `${cached}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(peaks))
    await rename(temp, cached)
    noteCacheHit(key, cached)
    scheduleCacheUpkeep()
    return peaks
  })
}
