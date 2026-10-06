/**
 * The app's one `AudioFxBaker`: its directory in the cache, bay's ffmpeg, and the `bay://` rule
 * for which files it may read and which it then serves. Bakes are swept at startup and after each
 * new one (`AUDIO_FX_CACHE_BYTES`); running bakes are killed on quit.
 */

import { join } from 'node:path'
import type { AudioEffect } from '@shared/audio-effects'
import type { AudioBakeRequest, AudioBakeResult } from '@shared/audio-bake'
import { ffmpegBin } from '../ffmpeg/ffmpeg'
import { CACHE_SCHEME } from '../media/cache-key'
import { cacheDir } from '../paths'
import { allowPath, isAllowed } from '../protocol'
import { AUDIO_FX_CACHE_FAMILY, AudioFxBaker } from './bake'

let baker: AudioFxBaker | null = null

/** `<cache>/audiofx-<scheme>`: the scheme in the name, so `sweepStaleCaches` reclaims an old one. */
export function audioFxDir(): string {
  return join(cacheDir(), `${AUDIO_FX_CACHE_FAMILY}-${CACHE_SCHEME}`)
}

export function audioFx(): AudioFxBaker {
  if (!baker) {
    baker = new AudioFxBaker({ dir: audioFxDir(), ffmpeg: ffmpegBin, isAllowed, onReady: allowPath })
  }
  return baker
}

/** The renderer's request: a bake from the cache or rendered now, then the family kept under its cap. */
export async function ensureAudioBake(request: AudioBakeRequest): Promise<AudioBakeResult> {
  const result = await audioFx().ensure(request)
  if (result.ok) void audioFx().sweep().catch(() => {})
  return result
}

/**
 * Every bake an export needs, by item id. Throws with the reason when one cannot be rendered: an
 * export that went on would write the clip's unprocessed sound into the file as though it were
 * the mix the user heard.
 */
export async function renderBakes(
  needs: readonly { itemId: string; path: string; effects: readonly AudioEffect[] }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const need of needs) {
    const result = await ensureAudioBake({ path: need.path, effects: need.effects })
    if (!result.ok) throw new Error(result.error)
    out.set(need.itemId, result.path)
  }
  return out
}

/** Startup: what a crash left half-written, and anything past the cap. */
export function sweepAudioBakes(): Promise<string[]> {
  return audioFx().sweep()
}

/** Quit: running bakes are killed. */
export function stopAudioBakes(): void {
  baker?.dispose()
}
