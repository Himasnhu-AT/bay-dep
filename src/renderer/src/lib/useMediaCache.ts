import { useEffect, useState } from 'react'
import type { Asset } from '@shared/project'
import { bay } from './bay'

/**
 * Posters, filmstrips and waveforms are expensive to make and identical every time they
 * are asked for, so they are cached for the life of the window rather than per component.
 *
 * The panel that shows them unmounts every time the user switches to Text or Effects, and
 * a cache that lives in component state means shelling out to ffmpeg again on the way
 * back. The cached value is a `bay://` URL or a peaks array, both small.
 *
 * These are the one place in the UI that swallows a bridge failure instead of routing it
 * through `call`, and it is deliberate: a poster that will not generate should leave a
 * clip looking plain, not raise an error over the timeline. Every clip on screen asks at
 * once, so one bad file would otherwise produce a burst of identical toasts.
 */
const posters = new Map<string, string | null>()
const filmstrips = new Map<string, string[]>()
const waveforms = new Map<string, number[]>()
const inflight = new Map<string, Promise<unknown>>()

/** Runs `work` once per key, even when several components ask during the same frame. */
function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = work().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

export function usePoster(asset: Asset | undefined, size = 160): string | null {
  const key = asset ? `${asset.id}:${size}` : ''
  const [url, setUrl] = useState<string | null>(() => posters.get(key) ?? null)

  useEffect(() => {
    if (!asset || !asset.path || asset.error) return
    // A .brf has no media for ffmpeg to take a frame of; the tile shows its icon.
    if (asset.kind === 'audio' || asset.kind === 'brf') return
    const cached = posters.get(key)
    if (cached !== undefined) {
      setUrl(cached)
      return
    }
    const api = bay()
    if (!api) return
    let live = true
    void once(`poster:${key}`, () =>
      api.media
        .thumbnail({
          assetId: asset.id,
          path: asset.path as string,
          // A frame one second in, because frame zero of a lot of footage is black.
          atUs: asset.durationUs > 2_000_000 ? 1_000_000 : 0,
          size
        })
        .catch(() => null)
    ).then((result) => {
      posters.set(key, result)
      if (live) setUrl(result)
    })
    return () => {
      live = false
    }
  }, [asset, key, size])

  return url
}

export function useFilmstrip(
  asset: Asset | undefined,
  count: number,
  height: number,
  enabled: boolean
): string[] {
  const key = asset ? `${asset.id}:${count}:${height}` : ''
  const [frames, setFrames] = useState<string[]>(() => filmstrips.get(key) ?? [])

  useEffect(() => {
    if (!enabled || !asset || !asset.path || !asset.hasVideo || asset.error) return
    const cached = filmstrips.get(key)
    if (cached) {
      setFrames(cached)
      return
    }
    const api = bay()
    if (!api) return
    let live = true
    void once(`strip:${key}`, () =>
      api.media
        .filmstrip({ assetId: asset.id, path: asset.path as string, count, height })
        .catch(() => [] as string[])
    ).then((result) => {
      filmstrips.set(key, result)
      if (live) setFrames(result)
    })
    return () => {
      live = false
    }
  }, [asset, key, count, height, enabled])

  return frames
}

export function useWaveform(asset: Asset | undefined, buckets: number, enabled: boolean): number[] {
  const key = asset ? `${asset.id}:${buckets}` : ''
  const [peaks, setPeaks] = useState<number[]>(() => waveforms.get(key) ?? [])

  useEffect(() => {
    if (!enabled || !asset || !asset.path || !asset.hasAudio || asset.error) return
    const cached = waveforms.get(key)
    if (cached) {
      setPeaks(cached)
      return
    }
    const api = bay()
    if (!api) return
    let live = true
    void once(`wave:${key}`, () =>
      api.media.waveform(asset.id, asset.path as string, buckets).catch(() => [] as number[])
    ).then((result) => {
      waveforms.set(key, result)
      if (live) setPeaks(result)
    })
    return () => {
      live = false
    }
  }, [asset, key, buckets, enabled])

  return peaks
}
