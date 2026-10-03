/**
 * `media:score-sfx`: a sound-effect score rendered to a WAV in `<userData>/generated`, where bay
 * keeps what it makes for a project (subtitles and freeze frames live there too).
 *
 * The synthesis is `@shared/sfx` and has no file in it; this joins it to a folder and to bay's
 * ffmpeg. Named by content, so the same score is the same file and therefore one asset, and a
 * changed score never overwrites a file a placed clip still plays. Written to a temporary name
 * and renamed, so a crash mid-write never leaves half a file at a name the import would accept.
 *
 * Loudness is read from the file that was written, by the same `ebur128` every other loudness
 * in bay comes from — one meter, not a second one in TypeScript that would have to agree with it.
 *
 * Kept free of Electron (`ipc.ts` supplies the folder) so the write and the measurement run
 * under `pnpm test` against the real binary. The score is checked again here although the
 * renderer checked it: this is the side that allocates the buffers.
 */

import { createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioSpan, SfxWriteResult } from '@shared/ipc'
import { renderScore, renderWarnings } from '@shared/sfx/render'
import { checkScore } from '@shared/sfx/score'
import { encodeWav } from '@shared/sfx/wav'
import { SILENCE_LUFS } from '@shared/loudness'
import { measureLoudness } from '../media/audio-analysis'

export type LoudnessMeter = (path: string, span: AudioSpan) => Promise<{ integratedLufs: number; truePeakDb: number }>

/** A file name's worth of the name the caller gave. */
export function sfxSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'score'
}

const round = (value: number, places: number): number => Number(value.toFixed(places))

export async function writeSfx(
  dir: string,
  name: unknown,
  input: unknown,
  meter: LoudnessMeter = measureLoudness
): Promise<SfxWriteResult> {
  const checked = checkScore(input)
  if (!checked.ok) return { ok: false, error: checked.errors.join(' ') }

  const rendered = renderScore(checked.score)
  const bytes = encodeWav(rendered.left, rendered.right, rendered.sampleRate)
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
  const path = join(dir, `sfx-${sfxSlug(typeof name === 'string' ? name : '')}-${hash}.wav`)
  const partial = `${path}.${process.pid}.part`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(partial, bytes)
    await rename(partial, path)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {})
    return {
      ok: false,
      error: `The sound was rendered but could not be written to ${dir}: ${error instanceof Error ? error.message : String(error)}. Nothing was added to the project.`
    }
  }

  let integratedLufs: number | null = null
  let truePeakDb: number | null = null
  let loudnessNote: string | undefined
  try {
    const measured = await meter(path, { startUs: 0, durationUs: 0 })
    truePeakDb = Number.isFinite(measured.truePeakDb) ? round(measured.truePeakDb, 1) : null
    // ebur128 reports its −70 LUFS gate, not a level, when no 400 ms block rises above it.
    if (Number.isFinite(measured.integratedLufs) && measured.integratedLufs > SILENCE_LUFS) {
      integratedLufs = round(measured.integratedLufs, 1)
    } else {
      loudnessNote =
        'There is no integrated loudness to report: EBU R128 needs 0.4 s of sound above −70 LUFS, and this score is shorter or quieter than that. The peak is still measured.'
    }
  } catch (error) {
    loudnessNote = `The file was written, but its loudness could not be measured: ${error instanceof Error ? error.message : String(error)}`
  }

  return {
    ok: true,
    path,
    seconds: round(rendered.seconds, 4),
    events: rendered.events,
    peakDb: Number.isFinite(rendered.peakDb) ? round(rendered.peakDb, 2) : null,
    limitedDb: round(rendered.limitedDb, 2),
    integratedLufs,
    truePeakDb,
    ...(loudnessNote ? { loudnessNote } : {}),
    warnings: [...checked.warnings, ...renderWarnings(checked.score, rendered)]
  }
}
