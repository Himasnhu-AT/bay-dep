/**
 * Audio playback and metering.
 *
 * The graph, per item, is:
 *
 *   element -> MediaElementAudioSourceNode -> item gain -> track gain -> analyser -> master
 *
 * Two placements in that chain are deliberate:
 *
 * - **The analyser sits before the mute point.** Muting a track disconnects its analyser
 *   from the master rather than setting a gain to zero, so the meter goes on showing what
 *   is on the track. A meter that reads silence because the track is muted is a meter
 *   lying about the material.
 * - **The item gain is per asset, not per item.** One element cannot play two places at
 *   once, so an asset used by two simultaneous items has one source node and one gain; the
 *   item being played owns it. Pretending otherwise would mean a gain node whose value
 *   flickers between two items every frame.
 *
 * Transport: this engine drives `<audio>` elements. `<video>` elements belong to the
 * compositor, because their picture is what schedules them, and it corrects their drift
 * against the same {@link DRIFT_TOLERANCE_SECONDS} — see compositor.ts.
 */

import {
  fadeGainAt,
  findAsset,
  itemEnd,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type Track
} from '@shared/project'
import { MediaPool, type MediaEntry } from './mediaPool'
import { DRIFT_TOLERANCE_SECONDS, clamp, clamp01, finite, playbackRateFor, sourceSecondsAt } from './sync'

export interface TrackLevel {
  /** 0..1, the largest sample magnitude in the last analyser window. */
  peak: number
  /** 0..1, root mean square over the same window — what a level meter should show. */
  rms: number
}

export interface AudioUpdate {
  project: Project
  timeline: Timeline
  frame: number
  playing: boolean
}

interface TrackNodes {
  gain: GainNode
  analyser: AnalyserNode
  /** False while the track is muted; the analyser stays fed either way. */
  audible: boolean
  samples: Uint8Array<ArrayBuffer>
}

interface SourceNodes {
  source: MediaElementAudioSourceNode
  gain: GainNode
  /** The track this asset's sound is currently routed into, or null when idle. */
  trackId: string | null
}

const ANALYSER_FFT_SIZE = 1024

export class AudioEngine {
  readonly #pool: MediaPool
  readonly #tracks = new Map<string, TrackNodes>()
  readonly #sources = new Map<string, SourceNodes>()
  readonly #releaseEvictListener: () => void
  #context: AudioContext | null = null
  #master: GainNode | null = null
  #masterVolume = 1

  constructor(pool: MediaPool) {
    this.#pool = pool
    // An evicted element takes its source node with it: a MediaElementAudioSourceNode is
    // bound to one element for life and cannot be re-pointed.
    this.#releaseEvictListener = pool.onEvict((entry) => this.#forget(entry))
  }

  /**
   * The context is created lazily and starts suspended until a gesture. Creating it in the
   * constructor would mean every launch has a suspended context whether or not audio is
   * ever used, and Chromium logs a warning that reads like a bug.
   */
  context(): AudioContext {
    if (this.#context) return this.#context
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.value = this.#masterVolume
    master.connect(context.destination)
    this.#context = context
    this.#master = master
    return context
  }

  /** True once anything has needed the context. Lets a caller avoid creating one. */
  get hasContext(): boolean {
    return this.#context !== null
  }

  /** Call from a user gesture — play, or the first click on the transport. */
  async resume(): Promise<void> {
    const context = this.context()
    if (context.state === 'suspended') await context.resume()
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = clamp(volume, 0, 2)
    if (this.#master) this.#master.gain.value = this.#masterVolume
  }

  /**
   * Brings the graph in line with the timeline at `frame`. Cheap enough to call once per
   * picture: it touches only the items that exist at this frame plus whatever was playing
   * and no longer is.
   */
  update({ project, timeline, frame, playing }: AudioUpdate): void {
    const context = this.context()
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30
    const active = new Set<string>()
    const liveTracks = new Set<string>()

    for (const track of timeline.tracks) {
      liveTracks.add(track.id)
      // Walked directly rather than through `itemsAtFrame`, which drops muted tracks. A
      // muted track still has to reach its analyser, or the meter goes dark and the user
      // cannot see what they muted.
      const nodes = this.#trackNodes(context, track)
      this.#setAudible(nodes, !track.muted)

      for (const item of track.items) {
        if (frame < item.from || frame >= itemEnd(item)) continue
        const asset = findAsset(project, item.assetId)
        if (!asset || asset.error || !asset.hasAudio) continue

        const entry = this.#pool.acquire(asset)
        const element = entry.element
        if (!(element instanceof HTMLVideoElement) && !(element instanceof HTMLAudioElement)) {
          continue
        }

        const source = this.#sourceNodes(context, asset.id, element)
        if (!source) continue
        active.add(asset.id)

        this.#route(source, nodes, track.id)
        source.gain.gain.value = clamp(finite(item.volume, 1), 0, 2) * fadeGainAt(item, frame)

        this.#drive(element, item, asset, frame, fps, playing)
      }
    }

    this.#silenceInactive(active)
    this.#pruneTracks(liveTracks)
  }

  /** Per-track levels for a meter, keyed by track id. Sampled at call time. */
  levels(): Record<string, TrackLevel> {
    const out: Record<string, TrackLevel> = {}
    for (const [trackId, nodes] of this.#tracks) {
      nodes.analyser.getByteTimeDomainData(nodes.samples)
      let peak = 0
      let sum = 0
      for (let i = 0; i < nodes.samples.length; i += 1) {
        // Byte time-domain data is centred on 128; 0 and 255 are full scale.
        const sample = ((nodes.samples[i] ?? 128) - 128) / 128
        const magnitude = Math.abs(sample)
        if (magnitude > peak) peak = magnitude
        sum += sample * sample
      }
      out[trackId] = {
        peak: clamp01(peak),
        rms: clamp01(Math.sqrt(sum / Math.max(1, nodes.samples.length)))
      }
    }
    return out
  }

  /** Pauses every element this engine drives. The compositor pauses the video elements. */
  stop(): void {
    this.#pool.forEach((entry) => {
      const element = entry.element
      if (element instanceof HTMLAudioElement && !element.paused) element.pause()
    })
  }

  dispose(): void {
    this.stop()
    this.#releaseEvictListener()
    for (const nodes of this.#tracks.values()) {
      nodes.analyser.disconnect()
      nodes.gain.disconnect()
    }
    this.#tracks.clear()
    for (const source of this.#sources.values()) {
      source.gain.disconnect()
      source.source.disconnect()
    }
    this.#sources.clear()
    this.#master?.disconnect()
    void this.#context?.close().catch(() => {})
    this.#context = null
    this.#master = null
  }

  // -- internals ------------------------------------------------------------

  #trackNodes(context: AudioContext, track: Track): TrackNodes {
    const existing = this.#tracks.get(track.id)
    if (existing) return existing
    const gain = context.createGain()
    const analyser = context.createAnalyser()
    analyser.fftSize = ANALYSER_FFT_SIZE
    gain.connect(analyser)
    const nodes: TrackNodes = {
      gain,
      analyser,
      audible: false,
      samples: new Uint8Array(new ArrayBuffer(analyser.fftSize))
    }
    this.#tracks.set(track.id, nodes)
    this.#setAudible(nodes, !track.muted)
    return nodes
  }

  #setAudible(nodes: TrackNodes, audible: boolean): void {
    if (audible === nodes.audible) return
    const master = this.#master
    if (!master) return
    if (audible) nodes.analyser.connect(master)
    else nodes.analyser.disconnect(master)
    nodes.audible = audible
  }

  #sourceNodes(
    context: AudioContext,
    assetId: string,
    element: HTMLVideoElement | HTMLAudioElement
  ): SourceNodes | null {
    const existing = this.#sources.get(assetId)
    if (existing) return existing
    try {
      const source = context.createMediaElementSource(element)
      const gain = context.createGain()
      source.connect(gain)
      const nodes: SourceNodes = { source, gain, trackId: null }
      this.#sources.set(assetId, nodes)
      return nodes
    } catch {
      // Creating a second source node for one element throws. That means something else
      // already owns this element's sound, which is not a reason to lose the picture.
      return null
    }
  }

  #route(source: SourceNodes, track: TrackNodes, trackId: string): void {
    if (source.trackId === trackId) return
    if (source.trackId !== null) source.gain.disconnect()
    source.gain.connect(track.gain)
    source.trackId = trackId
  }

  /**
   * Keeps an `<audio>` element where the timeline says it should be.
   *
   * The threshold is the point of this function. A playing element drifts continuously by
   * a millisecond or two; correcting that every frame is 30 discontinuities a second and
   * is audible as clicking. Correcting only past {@link DRIFT_TOLERANCE_SECONDS} leaves
   * the small error alone, which is inaudible, and fixes the large one, which is not.
   *
   * `<video>` elements are corrected by the compositor against the same constant, and
   * exactly one owner is not a preference: the compositor remembers which seek is
   * outstanding on each element so it does not re-issue one before the last has landed.
   * A second writer of `currentTime` would defeat that bookkeeping and the element would
   * restart its seek forever without arriving.
   */
  #drive(
    element: HTMLVideoElement | HTMLAudioElement,
    item: Item,
    asset: Asset,
    frame: number,
    fps: number,
    playing: boolean
  ): void {
    if (!(element instanceof HTMLAudioElement)) return

    element.playbackRate = playbackRateFor(item.speed)
    if (playing && element.paused) void element.play().catch(() => {})
    if (!playing && !element.paused) element.pause()

    if (element.seeking) return
    // Paused, the element is being positioned rather than corrected, so it is pinned to
    // the frame: a play from here has to start at the right sample, not 80ms into it.
    const tolerance = playing ? DRIFT_TOLERANCE_SECONDS : 0.5 / fps
    const expected = sourceSecondsAt(item, asset, frame, fps)
    if (Math.abs(element.currentTime - expected) <= tolerance) return
    try {
      element.currentTime = expected
    } catch {
      // Before metadata, a seek throws; the next frame retries.
    }
  }

  /**
   * Drops the nodes of deleted tracks. Without this, `levels()` goes on reporting a meter
   * for a track the user removed — and the UI, which keys off that record, draws it.
   */
  #pruneTracks(live: Set<string>): void {
    for (const [trackId, nodes] of this.#tracks) {
      if (live.has(trackId)) continue
      nodes.analyser.disconnect()
      nodes.gain.disconnect()
      this.#tracks.delete(trackId)
    }
  }

  /** Silences and pauses anything that was playing and is no longer under the playhead. */
  #silenceInactive(active: Set<string>): void {
    for (const [assetId, source] of this.#sources) {
      if (active.has(assetId)) continue
      source.gain.gain.value = 0
      if (source.trackId !== null) {
        source.gain.disconnect()
        source.trackId = null
      }
    }
    this.#pool.forEach((entry) => {
      if (active.has(entry.assetId)) return
      const element = entry.element
      if (element instanceof HTMLAudioElement && !element.paused) element.pause()
    })
  }

  #forget(entry: MediaEntry): void {
    const source = this.#sources.get(entry.assetId)
    if (!source) return
    source.gain.disconnect()
    source.source.disconnect()
    this.#sources.delete(entry.assetId)
  }
}
