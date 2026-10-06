/**
 * What the renderer knows about baked effect chains (`@shared/audio-effects`, `main/audio-fx`).
 *
 * The audio engine runs once per picture and cannot wait for ffmpeg, so — like
 * `compositionSounds` — this answers at once from what it already knows and asks main the first
 * time a (file, chain) pair is wanted. Until the answer arrives the state is `pending`: the
 * preview plays the clip unprocessed and the inspector says the sound is being processed. An
 * export never reads this; main renders what it needs itself before it builds the graph.
 *
 * **A chain is asked for only once it has held still.** Dragging a threshold passes through
 * dozens of values, and each is a different bake — tens of megabytes and seconds of ffmpeg for a
 * file nobody will play. A pair is asked for `SETTLE_MS` after it is first wanted, and not at all
 * if a newer chain for the same file was wanted meanwhile and this one never again.
 */

import { bakeSignature, type AudioEffect } from '@shared/audio-effects'
import type { AudioBakeLookup, AudioBakeRequest, AudioBakeResult, AudioBakeState } from '@shared/audio-bake'
import { bay } from '@/lib/bridge'

export const SETTLE_MS = 300

type Ask = (request: AudioBakeRequest) => Promise<AudioBakeResult> | null

interface Entry {
  state: AudioBakeState
  path: string
  firstWanted: number
  lastWanted: number
}

export interface AudioBakes {
  /** The engine's question: answers now, and starts the bake when it has not been asked for. */
  lookup: AudioBakeLookup
  /** The same answer without starting anything — null when this pair was never wanted. */
  peek(path: string, effects: readonly AudioEffect[]): AudioBakeState | null
  /** Forgets a failure so the next `lookup` tries again. */
  retry(path: string, effects: readonly AudioEffect[]): void
  /** Called whenever any state changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Bumped with every change: a snapshot for `useSyncExternalStore`. */
  version(): number
}

const PENDING: AudioBakeState = { state: 'pending' }

export function createAudioBakes(
  ask: Ask = (request) => bay()?.media.audioEffectBake(request) ?? null,
  clock: { now: () => number; later: (fn: () => void, ms: number) => void } = {
    now: () => Date.now(),
    later: (fn, ms) => void setTimeout(fn, ms)
  }
): AudioBakes {
  const entries = new Map<string, Entry>()
  /** When a chain not seen before was last wanted for each file. */
  const newestChainAt = new Map<string, number>()
  const listeners = new Set<() => void>()
  let version = 0
  const changed = (): void => {
    version += 1
    for (const listener of listeners) listener()
  }
  const keyOf = (path: string, effects: readonly AudioEffect[]): string => `${path}\u0000${bakeSignature(effects)}`

  const start = (key: string, entry: Entry, effects: readonly AudioEffect[]): void => {
    // Superseded: a newer chain for this file arrived, and nothing has wanted this one since.
    const newer = newestChainAt.get(entry.path) ?? 0
    if (newer > entry.firstWanted && entry.lastWanted < newer) {
      entries.delete(key)
      return
    }
    const asked = ask({ path: entry.path, effects })
    if (!asked) {
      entry.state = { state: 'failed', error: 'bay could not reach its media process to render this sound.' }
      changed()
      return
    }
    void asked
      .then((result) => {
        entry.state = result.ok
          ? { state: 'ready', key: result.key, path: result.path }
          : { state: 'failed', error: result.error }
      })
      .catch((error: unknown) => {
        entry.state = { state: 'failed', error: error instanceof Error ? error.message : String(error) }
      })
      .finally(changed)
  }

  return {
    lookup(path, effects) {
      const key = keyOf(path, effects)
      const now = clock.now()
      const found = entries.get(key)
      if (found) {
        found.lastWanted = now
        return found.state
      }
      const entry: Entry = { state: PENDING, path, firstWanted: now, lastWanted: now }
      entries.set(key, entry)
      newestChainAt.set(path, now)
      // A copy: the caller's array belongs to the project and may be replaced before the timer fires.
      const chain = effects.map((e) => ({ ...e, params: { ...e.params } }))
      clock.later(() => start(key, entry, chain), SETTLE_MS)
      changed()
      return entry.state
    },
    peek(path, effects) {
      return entries.get(keyOf(path, effects))?.state ?? null
    },
    retry(path, effects) {
      const key = keyOf(path, effects)
      if (entries.get(key)?.state.state !== 'failed') return
      entries.delete(key)
      changed()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version
  }
}

/** The editor's one registry: the preview engine and the inspector read the same states. */
export const audioBakes = createAudioBakes()
