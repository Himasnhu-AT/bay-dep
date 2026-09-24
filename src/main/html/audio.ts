/**
 * Which of a composition's declared sounds will actually play.
 *
 * The shared parser can say what a composition *declares*; only main can say whether the file
 * is there and whether ffmpeg can decode it. Both matter for the same reason: a declared sound
 * that cannot be opened is an export input ffmpeg refuses, and one refused input fails the
 * whole `amix` — every clip on the timeline would lose its audio over one missing whoosh. So a
 * sound is checked here once, and anything that fails becomes a fault with its line instead of
 * an entry, for read_composition, preview and export alike.
 *
 * Kept out of `compositions.ts` because that file imports `electron` and is unreachable from
 * `pnpm test`; the file system and the probe are injected so this is not.
 */

import { stat } from 'node:fs/promises'
import type { CompositionFault, CompositionSound } from '@shared/composition'

export interface SoundChecks {
  /** True when `path` is a regular file. */
  isFile(path: string): Promise<boolean>
  /** Whether ffprobe finds an audio stream in `path`. Throws when it cannot read it at all. */
  hasAudio(path: string): Promise<boolean>
}

export const fileChecks: Pick<SoundChecks, 'isFile'> = {
  async isFile(path) {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  }
}

/**
 * The sounds that will play, and a fault for each that will not.
 *
 * Every sound is checked rather than stopping at the first failure, because a composition with
 * two broken sounds has two things to fix. A sound with no resolved `path` was already reported
 * by the parser and is passed over here.
 */
export async function checkSounds(
  sounds: readonly CompositionSound[],
  checks: SoundChecks
): Promise<{ playable: CompositionSound[]; faults: CompositionFault[] }> {
  const playable: CompositionSound[] = []
  const faults: CompositionFault[] = []
  for (const sound of sounds) {
    if (sound.path === null) continue
    const fault = (message: string): void => {
      faults.push({ code: 'bad-audio', message, line: sound.line, fatal: false })
    }
    if (!(await checks.isFile(sound.path))) {
      fault(
        `<audio id="${sound.id}"> names src="${sound.src}", which resolves to ${sound.path} — ` +
          `there is no file there, so it is not mixed. src is relative to the composition's ` +
          `own file; save the sound there or correct the path.`
      )
      continue
    }
    let audible: boolean
    try {
      audible = await checks.hasAudio(sound.path)
    } catch (error) {
      fault(
        `<audio id="${sound.id}"> names ${sound.path}, which ffprobe could not read ` +
          `(${(error as Error).message}), so it is not mixed. Use a wav, mp3, m4a, ogg or flac file.`
      )
      continue
    }
    if (!audible) {
      fault(
        `<audio id="${sound.id}"> names ${sound.path}, which has no audio stream, so it is not ` +
          `mixed. Point src at a sound file.`
      )
      continue
    }
    playable.push(sound)
  }
  return { playable, faults }
}
