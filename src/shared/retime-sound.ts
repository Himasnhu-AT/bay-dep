/**
 * What a reversed or ramped clip's sound does — decided once, for the preview, the export, the
 * inspector's notice and the agent's tool result. The sentence was written before the type.
 *
 * The preview plays sound from media elements and the export from an ffmpeg graph, and they can
 * only be made to agree about what each of them can actually do:
 *
 * - **Forwards at one speed** — both play it: `playbackRate` in the preview, `atempo` in the
 *   export, both keeping pitch. Nothing new.
 * - **Reversed** — the export plays it backwards (`areverse` over exactly the footage the clip
 *   reads, then `atempo`). A media element cannot play backwards, so **the preview is silent for
 *   that clip**. The two differ, and the notice says so wherever the clip is shown.
 * - **On a speed ramp** — **silent in both.** The preview could follow a ramp by changing
 *   `playbackRate` every frame and the export by a chain of per-frame `atempo` pieces, but those
 *   are two different time-stretchers re-started at different moments, and nothing here has
 *   measured them against each other. Silence in both is the one answer that is the same; a ramp
 *   that sounded one way while editing and another in the file would not be. `itemAudioGainAt`
 *   and `volumeMayBeAudible` are where it is enforced.
 *
 * A hold is a ramp, so a held frame is silent, which is what a freeze is.
 */

import type { Item } from './project'

export interface RetimeSound {
  /** Heard while editing. */
  preview: 'plays' | 'silent'
  /** Heard in the exported file. */
  export: 'plays' | 'reversed' | 'silent'
  /** True when the clip makes no sound anywhere — the shared gain is 0. */
  mutedEverywhere: boolean
  /** What to tell the person, or null when the clip sounds as any clip does. */
  notice: string | null
}

const PLAIN: RetimeSound = { preview: 'plays', export: 'plays', mutedEverywhere: false, notice: null }

export function retimeSound(item: Pick<Item, 'reverse' | 'keyframes'>): RetimeSound {
  const ramped = Boolean(item.keyframes?.speed && item.keyframes.speed.length > 0)
  if (ramped) {
    return {
      preview: 'silent',
      export: 'silent',
      mutedEverywhere: true,
      notice:
        'A clip on a speed ramp is silent, in the preview and in the export. ' +
        'Remove the ramp (one constant speed) to hear it, or put its sound on a clip of its own that is not ramped.'
    }
  }
  if (item.reverse) {
    return {
      preview: 'silent',
      export: 'reversed',
      mutedEverywhere: false,
      notice: 'A reversed clip is silent in the preview. Its sound plays backwards in the exported file.'
    }
  }
  return PLAIN
}
