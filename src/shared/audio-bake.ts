/**
 * The contract for a baked effect chain: what the renderer asks main for and what it gets back
 * (`main/audio-fx/bake.ts` renders it; `@shared/audio-effects` says what is baked and why).
 */

import type { AudioEffect } from './audio-effects'

export interface AudioBakeRequest {
  /** The source file whose whole audio stream is processed. */
  path: string
  /** The stages to render, in order — `itemEffectPlan(...).bake`. Checked again in main. */
  effects: readonly AudioEffect[]
}

export type AudioBakeResult =
  | {
      ok: true
      /** Content of the file plus the chain: the same sound twice is one file. */
      key: string
      /** The processed WAV, admitted to `bay://`. Same length and timing as the source's audio. */
      path: string
    }
  | { ok: false; error: string }

/**
 * What the preview and the inspector know about one bake:
 * - `ready` — the processed file exists; the clip plays it.
 * - `pending` — being rendered. The preview plays the clip **unprocessed** meanwhile and the
 *   inspector says so; an export never does — it waits for the bake.
 * - `failed` — it could not be rendered; `error` says why. The preview plays the clip unprocessed
 *   and the inspector shows the error; an export fails with it rather than write the dry sound.
 */
export type AudioBakeState =
  | { state: 'ready'; key: string; path: string }
  | { state: 'pending' }
  | { state: 'failed'; error: string }

/** Answers at once from what is known; asking starts the bake when it has not been asked for. */
export type AudioBakeLookup = (path: string, effects: readonly AudioEffect[]) => AudioBakeState
