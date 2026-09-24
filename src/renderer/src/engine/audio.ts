/**
 * Audio playback and metering.
 *
 * The graph, per item, is:
 *
 *   element -> MediaElementAudioSourceNode -> item gain -> pan -> track gain -> analyser -> master
 *
 * The item gain node is held at two channels (a mono source is up-mixed L = R there, as the
 * speakers would), and the pan is a gain per channel — splitter, two gains, merger — set from
 * `panGains`, the law export's `pan` filter is written from.
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
 *
 * **HTML compositions** have no media element of their own — their picture is captured from a
 * hidden page — so their sound comes from what they *declare*: each `<audio id src data-start>`
 * becomes a stand-in audio asset with its own `<audio>` element, routed into the clip's track
 * exactly like a clip's sound, positioned by the shared schedule in `@shared/composition-audio`
 * and scaled by `itemAudioGainAt` — the same two functions export mixes with.
 */

import {
  findAsset,
  itemEnd,
  trackAudible,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type Track,
  playableTimeline
} from '@shared/project'
import type { CompositionSound } from '@shared/composition'
import { audibleSpan, itemAudioGainAt, panGains, resolveAudioOffsets, transitionOfItemAt } from '@shared/audio-gain'
import { linkedPartners, soundAlignedWithPicture } from '@shared/links'
import {
  scheduleCompositionSounds,
  soundSecondsAt,
  type ScheduledSound
} from '@shared/composition-audio'
import { inspectedSounds, type SoundLookup } from './compositionSounds'
import { MediaPool, type MediaEntry } from './mediaPool'
import { elementSlots, itemsToDraw } from './compositor'
import { transitionAudioGains } from './transitions'
import { DRIFT_TOLERANCE_SECONDS, clamp, clamp01, finite, playbackRateFor, sourceSecondsAt } from './sync'

export interface TrackLevel {
  /** 0..1, the largest sample magnitude in the last analyser window. */
  peak: number
  /** 0..1, root mean square over the same window — what a level meter should show. */
  rms: number
}

/** One item's sound at a frame, and how the track's flags route it. */
export interface AudioRouting {
  item: Item
  track: Track
  asset: Asset
  /**
   * Which of the asset's elements this item's sound comes from.
   *
   * Non-zero only when one asset is drawn twice in a frame — a transition between two halves
   * of a split clip. The two clips need two elements to show two source times, and therefore
   * two source nodes: one node per asset would mean the dissolve shows both pictures and
   * plays one. **Taken from the same `elementSlots` the compositor uses**, because a source
   * node bound to a different element than the one being drawn is a lip-sync bug with no
   * single place to look.
   */
  slot: number
  /**
   * A cross-fade multiplier from a transition playing over this item, 1 otherwise.
   *
   * Separate from `item.volume` and the fade envelope so all three compose: a clip at volume
   * 0.5 with a fade-in, inside a dissolve, is the product of the three.
   */
  transitionGain: number
  /**
   * The item's whole gain at this frame — `itemAudioGainAt`, the function export's envelope is
   * sampled from, so volume, fades, transitions, J/L offsets and ducking are decided once for
   * both. `transitionGain` above is one factor of it, kept for the routing tests that pin it.
   */
  gain: number
  /** The item's per-channel pan gains — `panGains(item.pan)`, what export's `pan` filter writes. */
  pan: { left: number; right: number }
  /**
   * Set when the item's sound is *detached* from its picture — a J/L cut, whose sound runs
   * before or after the frames its picture is drawn on. It then plays from its own `<audio>`
   * element (`asset` is a stand-in over the same file), positioned at `mediaSeconds`, for the
   * whole of its audible span: switching from a stand-in to the video element at the picture
   * cut would put a seam in the sound exactly where a J-cut is meant to hide one.
   *
   * `claim` names the picture's own element when the picture is drawn this frame. Its sound must
   * be *owned* by the graph and left silent, because a media element no source node has claimed
   * plays straight to the speakers — a second, unmixed copy of the same sound.
   */
  detached?: { mediaSeconds: number; claim: { asset: Asset; slot: number } | null }
  /**
   * True when this item reaches its track's analyser — i.e. the meter shows it. Mute does
   * not switch this off: the meter must keep showing what is on a muted track, or it is
   * lying about the material.
   */
  metered: boolean
  /** True when the track's sound reaches the master. This is what `muted` governs. */
  audible: boolean
}

/**
 * Every item contributing sound at `frame`, with its routing.
 *
 * The model this encodes, and it is the whole reason this is a function rather than a loop
 * buried in `update`: **`hidden` governs picture only, `muted` governs sound only, and both
 * apply to tracks of either kind.** Two independent properties, two independent outputs.
 * Hiding a layer to see what is under it must not change the mix you are judging, and
 * silencing a video track that carries speech must not require blanking its picture.
 *
 * So this deliberately does *not* consult `hidden`, and deliberately does not go through
 * `itemsAtFrame`, which filters by both flags for the compositor's benefit.
 */
export function audioRoutingAt(project: Project, timeline: Timeline, frame: number): AudioRouting[] {
  const out: AudioRouting[] = []
  // The same list and the same slot assignment the compositor draws from, so a source node is
  // always bound to the element its picture comes from.
  const { items: drawing, active } = itemsToDraw(project, timeline, frame, 'sound')
  const slots = elementSlots(drawing)
  // What the compositor actually draws this frame — the elements a detached sound may share.
  const pictureSlots = elementSlots(itemsToDraw(project, timeline, frame, 'picture').items)
  const gains = active
    ? transitionAudioGains(active.resolved.transition.kind, active.progress)
    : null

  const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30

  const push = (item: Item, track: Track, transitionGain: number): void => {
    const asset = findAsset(project, item.assetId)
    // An asset that failed to probe has no decodable audio; ffmpeg refuses to open it, and on
    // the export side one bad input fails the whole mix.
    if (!asset || asset.error || !asset.hasAudio) return
    const gain = itemAudioGainAt(project, timeline, item, frame)
    if (!isDetached(project, timeline, item)) {
      out.push({
        item,
        track,
        asset,
        slot: slots.get(item.id) ?? 0,
        transitionGain,
        gain,
        pan: panGains(item.pan),
        metered: true,
        audible: trackAudible(timeline.tracks, track)
      })
      return
    }
    const standIn = detachedAsset(asset, item)
    const drawn = slots.get(item.id)
    out.push({
      item,
      track,
      asset: standIn,
      slot: 0,
      transitionGain,
      gain,
      pan: panGains(item.pan),
      detached: {
        mediaSeconds: sourceSecondsAt(item, standIn, frame, fps),
        claim: drawn !== undefined && asset.hasVideo ? { asset, slot: drawn } : null
      },
      metered: true,
      audible: trackAudible(timeline.tracks, track)
    })
  }

  const trackOf = (item: Item): Track | undefined =>
    timeline.tracks.find((t) => t.items.some((i) => i.id === item.id))

  // Items on audio tracks sound over their whole audible span — J/L offsets and the handles of
  // every transition of their own — and are routed after the picture tracks' clips, below.
  const onAudioTracks: { item: Item; track: Track }[] = []

  for (const track of timeline.tracks) {
    for (const item of track.items) {
      // A picture whose sound was detached plays none of its own; its linked audio item does.
      if (item.audioDetached) continue
      if (track.kind === 'audio') {
        const span = audibleSpan(project, timeline, item)
        if (frame >= span.firstFrame && frame < span.endFrame) onAudioTracks.push({ item, track })
        continue
      }
      // A transition's two clips are handled below: inside the window only one of them
      // contains the frame, and both must sound.
      if (active && (item.id === active.resolved.from.id || item.id === active.resolved.to.id)) {
        continue
      }
      // A J/L cut sounds outside its picture's frames, over its audible span.
      if (isDetached(project, timeline, item)) {
        const span = audibleSpan(project, timeline, item)
        if (frame < span.firstFrame || frame >= span.endFrame) continue
      } else if (frame < item.from || frame >= itemEnd(item)) continue
      push(item, track, 1)
    }
  }

  if (active && gains) {
    const fromTrack = trackOf(active.resolved.from)
    const toTrack = trackOf(active.resolved.to)
    if (fromTrack?.kind === 'video' && !active.resolved.from.audioDetached) {
      push(active.resolved.from, fromTrack, gains.from)
    }
    if (toTrack?.kind === 'video' && !active.resolved.to.audioDetached) {
      push(active.resolved.to, toTrack, gains.to)
    }
  }

  // Audio-track clips. Two clips of one audio file sounding at once — the halves of a split clip
  // cross-fading — need an element each, earliest first on slot 0, which is the slot the outgoing
  // one was already playing on.
  onAudioTracks.sort((a, b) => a.item.from - b.item.from)
  const audioSlotsUsed = new Map<string, number>()
  for (const { item, track } of onAudioTracks) {
    const asset = findAsset(project, item.assetId)
    if (!asset || asset.error || !asset.hasAudio) continue
    const transition = transitionOfItemAt(project, timeline, item, frame)
    const transitionGain = transition
      ? transitionAudioGains(transition.resolved.transition.kind, transition.progress)[
          transition.resolved.from.id === item.id ? 'from' : 'to'
        ]
      : 1
    const gain = itemAudioGainAt(project, timeline, item, frame)

    if (asset.hasVideo) {
      // A video file's sound on an audio track: the detached sound of a clip. Where it plays
      // exactly what its linked picture is showing, it shares the element the compositor is
      // already decoding for that picture — one decode for the clip, as before the detach.
      // Anywhere else it has an `<audio>` element of its own, and a drawn linked picture's
      // element is claimed silently so its sound cannot reach the speakers unmixed.
      const picture = sharedPicture(timeline, item, pictureSlots)
      if (picture !== null && !isDetached(project, timeline, item)) {
        out.push({ item, track, asset, slot: picture.slot, transitionGain, gain, pan: panGains(item.pan), metered: true, audible: trackAudible(timeline.tracks, track) })
        continue
      }
      const standIn = detachedAsset(asset, item)
      const partner = linkedPartners(timeline, item.id).find((p) => pictureSlots.has(p.id) && p.assetId === asset.id)
      out.push({
        item,
        track,
        asset: standIn,
        slot: 0,
        transitionGain,
        gain,
        pan: panGains(item.pan),
        detached: {
          mediaSeconds: sourceSecondsAt(item, standIn, frame, fps),
          claim: partner ? { asset, slot: pictureSlots.get(partner.id) ?? 0 } : null
        },
        metered: true,
        audible: trackAudible(timeline.tracks, track)
      })
      continue
    }

    const slot = audioSlotsUsed.get(asset.id) ?? 0
    audioSlotsUsed.set(asset.id, slot + 1)
    out.push({ item, track, asset, slot, transitionGain, gain, pan: panGains(item.pan), metered: true, audible: trackAudible(timeline.tracks, track) })
  }

  return out
}

/**
 * The drawn picture element a detached sound can play from: its linked picture, drawn this frame,
 * showing exactly the source this sound plays (`soundAlignedWithPicture`). Null otherwise.
 */
function sharedPicture(
  timeline: Timeline,
  item: Item,
  pictureSlots: ReadonlyMap<string, number>
): { picture: Item; slot: number } | null {
  for (const partner of linkedPartners(timeline, item.id)) {
    const slot = pictureSlots.get(partner.id)
    if (slot === undefined || !soundAlignedWithPicture(item, partner)) continue
    return { picture: partner, slot }
  }
  return null
}

/**
 * Picture elements drawn at `frame` whose own sound must not be heard: clips whose audio was
 * detached. Each is claimed by a source node that is never routed, because a media element no
 * source node has claimed plays straight to the speakers. Where a linked audio item shares the
 * element this frame, its routing marks the node active and the claim changes nothing.
 */
export function silentPictureClaimsAt(
  project: Project,
  timeline: Timeline,
  frame: number
): { asset: Asset; slot: number }[] {
  const drawing = itemsToDraw(project, timeline, frame, 'picture').items
  const slots = elementSlots(drawing)
  const out: { asset: Asset; slot: number }[] = []
  for (const item of drawing) {
    if (!item.audioDetached) continue
    const asset = findAsset(project, item.assetId)
    if (!asset || asset.error || !asset.hasAudio || !asset.hasVideo) continue
    out.push({ asset, slot: slots.get(item.id) ?? 0 })
  }
  return out
}

/** True when `item` has a J/L offset that survives clamping, so its sound leaves its picture. */
function isDetached(project: Project, timeline: Timeline, item: Item): boolean {
  if (!item.audioLeadFrames && !item.audioTrailFrames) return false
  const offsets = resolveAudioOffsets(project, timeline, item)
  return offsets.leadFrames > 0 || offsets.trailFrames > 0
}

/**
 * The stand-in a detached item's sound plays from: the same file as an audio-only asset, keyed
 * per *item*, so the pool gives it an `<audio>` element of its own that no picture ever seeks.
 * Its duration is the source's, so `sourceSecondsAt` clamps to the same end.
 */
function detachedAsset(asset: Asset, item: Item): Asset {
  return {
    ...asset,
    id: `${asset.id}~detached~${item.id}`,
    kind: 'audio',
    hasVideo: false,
    width: null,
    height: null
  }
}

/** One declared composition sound heard at a frame, and how to play it. */
export interface SoundRouting {
  item: Item
  track: Track
  /**
   * A stand-in asset for the sound file, so the media pool holds its element the way it holds
   * any clip's — and evicts it, and retires it when idle, by the same rules. Its id is per
   * *item*, not per composition: two placements of one composition overlapping in time are two
   * sounds at two positions, and one element cannot be in two places.
   */
  asset: Asset
  entry: ScheduledSound
  /** The item's gain at this frame times the sound's own `data-volume`. */
  gain: number
  /** The composition clip's pan: its declared sounds are its sound. */
  pan: { left: number; right: number }
  /** Where in the sound file playback should be at this frame. */
  mediaSeconds: number
  /** As for clips: `muted` governs sound, and a muted track still meters. */
  audible: boolean
}

/** The stand-in asset id for sound `index` of `item`. */
function soundAssetId(item: Item, index: number): string {
  return `${item.assetId}~sound~${item.id}~${index}`
}

function soundAsset(item: Item, entry: ScheduledSound): Asset {
  return {
    id: soundAssetId(item, entry.index),
    kind: 'audio',
    name: entry.sound.id,
    path: entry.sound.path,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: true,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

/**
 * Every declared composition sound heard at `frame`.
 *
 * The same walk as {@link audioRoutingAt} — every track, `hidden` ignored, `muted` routed rather
 * than skipped — over the items whose asset is a composition. `lookup` answers what each one
 * declares; a composition it cannot answer for yet is silent this frame, not an error.
 */
export function compositionSoundsAt(
  project: Project,
  timeline: Timeline,
  frame: number,
  lookup: SoundLookup
): SoundRouting[] {
  const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30
  const out: SoundRouting[] = []
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.kind !== 'html' || asset.error) continue
      const span = audibleSpan(project, timeline, item)
      if (frame < span.firstFrame || frame >= span.endFrame) continue
      const declared: readonly CompositionSound[] | null = lookup(asset)
      if (!declared || declared.length === 0) continue
      const schedule = scheduleCompositionSounds(
        item,
        span,
        asset.durationUs / 1_000_000,
        declared,
        fps
      )
      for (const entry of schedule) {
        const mediaSeconds = soundSecondsAt(entry, frame / fps)
        if (mediaSeconds === null) continue
        out.push({
          item,
          track,
          asset: soundAsset(item, entry),
          entry,
          gain: itemAudioGainAt(project, timeline, item, frame) * entry.sound.volume,
          pan: panGains(item.pan),
          mediaSeconds,
          audible: trackAudible(timeline.tracks, track)
        })
      }
    }
  }
  return out
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

interface MeterNodes {
  input: GainNode
  left: AnalyserNode
  right: AnalyserNode
  samples: Float32Array<ArrayBuffer>
}

interface SourceNodes {
  source: MediaElementAudioSourceNode
  gain: GainNode
  /** The pan: one gain per channel between a splitter and a merger. */
  left: GainNode
  right: GainNode
  /** What is routed into a track — the pan's merger. Disconnecting it unroutes the source. */
  output: AudioNode
  /** The track this asset's sound is currently routed into, or null when idle. */
  trackId: string | null
}

const ANALYSER_FFT_SIZE = 1024

/**
 * Peak and RMS of one analyser window of float samples (-1..1). Peak is not clamped: a sample
 * past full scale is exactly what a clip indicator exists to show.
 */
export function levelOf(samples: ArrayLike<number>): TrackLevel {
  let peak = 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0
    const magnitude = Math.abs(sample)
    if (magnitude > peak) peak = magnitude
    sum += sample * sample
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples.length)) }
}

/** Source nodes are per element, not per asset. Mirrors the pool's own slot keying. */
function sourceKey(assetId: string, slot: number): string {
  return slot === 0 ? assetId : `${assetId}#${slot}`
}

export class AudioEngine {
  readonly #pool: MediaPool
  readonly #tracks = new Map<string, TrackNodes>()
  readonly #sources = new Map<string, SourceNodes>()
  readonly #releaseEvictListener: () => void
  readonly #sounds: SoundLookup
  #context: AudioContext | null = null
  #master: GainNode | null = null
  #masterVolume = 1
  /** The stereo tap the master meter reads: after the master gain, so it shows what you hear. */
  #meter: MeterNodes | null = null

  constructor(pool: MediaPool, sounds: SoundLookup = inspectedSounds()) {
    this.#pool = pool
    this.#sounds = sounds
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
    this.#meter = this.#createMeter(context, master)
    return context
  }

  /**
   * A tap off the master, split into two analysers. Its own node forced to two channels, so a
   * mono mix is metered on both sides (the speakers up-mix it that way too) rather than the
   * right meter reading silence — and the master itself is left exactly as it was. Analysers
   * are pulled by the context whether or not anything is downstream, so it goes nowhere.
   */
  #createMeter(context: AudioContext, master: GainNode): MeterNodes {
    const input = context.createGain()
    input.channelCount = 2
    input.channelCountMode = 'explicit'
    input.channelInterpretation = 'speakers'
    const splitter = context.createChannelSplitter(2)
    const left = context.createAnalyser()
    const right = context.createAnalyser()
    left.fftSize = ANALYSER_FFT_SIZE
    right.fftSize = ANALYSER_FFT_SIZE
    master.connect(input)
    input.connect(splitter)
    splitter.connect(left, 0)
    splitter.connect(right, 1)
    return { input, left, right, samples: new Float32Array(new ArrayBuffer(ANALYSER_FFT_SIZE * 4)) }
  }

  /**
   * The master's stereo level, sampled at call time; null before anything has needed sound. What
   * the transport's meter draws — read from a rAF loop, never from React.
   */
  masterLevels(): { left: TrackLevel; right: TrackLevel } | null {
    const meter = this.#meter
    if (!meter) return null
    meter.left.getFloatTimeDomainData(meter.samples)
    const left = levelOf(meter.samples)
    meter.right.getFloatTimeDomainData(meter.samples)
    return { left, right: levelOf(meter.samples) }
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
  update({ project, timeline: given, frame, playing }: AudioUpdate): void {
    // A disabled clip sounds nowhere; export's graph takes the same view (`buildAudioGraph`).
    const timeline = playableTimeline(given)
    const context = this.context()
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30
    const active = new Set<string>()
    const liveTracks = new Set<string>()

    // Node setup and mute first, for every track — including tracks with no items, whose
    // meters must still exist and read zero rather than vanish.
    for (const track of timeline.tracks) {
      liveTracks.add(track.id)
      const nodes = this.#trackNodes(context, track)
      this.#setAudible(nodes, trackAudible(timeline.tracks, track))
    }

    {
      // Detached pictures first: their elements are owned silently before anything routes, so a
      // linked sound sharing one this frame finds the node already made.
      for (const claim of silentPictureClaimsAt(project, timeline, frame)) {
        const drawn = this.#pool.acquire(claim.asset, claim.slot).element
        if (drawn instanceof HTMLVideoElement) {
          this.#sourceNodes(context, sourceKey(claim.asset.id, claim.slot), drawn)
        }
      }

      for (const routed of audioRoutingAt(project, timeline, frame)) {
        const { item, track, asset } = routed
        const nodes = this.#tracks.get(track.id)
        if (!nodes) continue

        // A detached (J/L) item's picture element is claimed silently first: owned by a source
        // node that is never marked active, so `#silenceInactive` holds it at zero instead of
        // letting the compositor's playback reach the speakers unmixed.
        const claim = routed.detached?.claim
        if (claim) {
          const drawn = this.#pool.acquire(claim.asset, claim.slot).element
          if (drawn instanceof HTMLVideoElement) {
            this.#sourceNodes(context, sourceKey(claim.asset.id, claim.slot), drawn)
          }
        }

        const entry = this.#pool.acquire(asset, routed.slot)
        const element = entry.element
        if (!(element instanceof HTMLVideoElement) && !(element instanceof HTMLAudioElement)) {
          continue
        }

        // Keyed by element. A `MediaElementAudioSourceNode` is bound to one element for life,
        // so an asset drawn twice in a frame needs two nodes — one per element — or the
        // transition shows two pictures and plays one.
        const key = sourceKey(asset.id, routed.slot)
        const source = this.#sourceNodes(context, key, element)
        if (!source) continue
        active.add(key)

        this.#route(source, nodes, track.id)
        // The shared gain — volume, fades, transition, J/L offsets, duck — the same function
        // export's envelope is sampled from, so the two cannot be re-decided apart.
        source.gain.gain.value = clamp(finite(routed.gain, 0), 0, 2)
        this.#setPan(source, routed.pan)

        if (routed.detached) {
          if (element instanceof HTMLAudioElement) {
            this.#position(element, item.speed, routed.detached.mediaSeconds, fps, playing)
          }
        } else {
          this.#drive(element, item, asset, frame, fps, playing)
        }
      }

      // Declared composition sounds, through the same nodes: an element, a source node keyed
      // by the stand-in asset, the track's gain and analyser.
      for (const routed of compositionSoundsAt(project, timeline, frame, this.#sounds)) {
        const nodes = this.#tracks.get(routed.track.id)
        if (!nodes) continue
        const element = this.#pool.acquire(routed.asset).element
        if (!(element instanceof HTMLAudioElement)) continue
        const key = sourceKey(routed.asset.id, 0)
        const source = this.#sourceNodes(context, key, element)
        if (!source) continue
        active.add(key)
        this.#route(source, nodes, routed.track.id)
        source.gain.gain.value = clamp(finite(routed.gain, 0), 0, 8)
        this.#setPan(source, routed.pan)
        this.#position(element, routed.entry.speed, routed.mediaSeconds, fps, playing)
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
      source.output.disconnect()
      source.gain.disconnect()
      source.source.disconnect()
    }
    this.#sources.clear()
    this.#master?.disconnect()
    this.#meter?.input.disconnect()
    void this.#context?.close().catch(() => {})
    this.#context = null
    this.#master = null
    this.#meter = null
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
    key: string,
    element: HTMLVideoElement | HTMLAudioElement
  ): SourceNodes | null {
    const existing = this.#sources.get(key)
    if (existing) return existing
    try {
      const source = context.createMediaElementSource(element)
      const gain = context.createGain()
      // Two channels from here on, so the pan has a left and a right to weigh: a mono source is
      // up-mixed to two identical channels ('speakers'), which is what the destination did to
      // it before this node was here — an unpanned mono clip sounds exactly as it did.
      gain.channelCount = 2
      gain.channelCountMode = 'explicit'
      gain.channelInterpretation = 'speakers'
      const splitter = context.createChannelSplitter(2)
      const left = context.createGain()
      const right = context.createGain()
      const merger = context.createChannelMerger(2)
      source.connect(gain)
      gain.connect(splitter)
      splitter.connect(left, 0)
      splitter.connect(right, 1)
      left.connect(merger, 0, 0)
      right.connect(merger, 0, 1)
      const nodes: SourceNodes = { source, gain, left, right, output: merger, trackId: null }
      this.#sources.set(key, nodes)
      return nodes
    } catch {
      // Creating a second source node for one element throws. That means something else
      // already owns this element's sound, which is not a reason to lose the picture.
      return null
    }
  }

  #route(source: SourceNodes, track: TrackNodes, trackId: string): void {
    if (source.trackId === trackId) return
    if (source.trackId !== null) source.output.disconnect()
    source.output.connect(track.gain)
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
    this.#position(element, item.speed, sourceSecondsAt(item, asset, frame, fps), fps, playing)
  }

  /**
   * The transport half of {@link #drive}, shared with composition sounds, whose position comes
   * from their schedule rather than from `sourceSecondsAt`.
   */
  #position(
    element: HTMLAudioElement,
    speed: number,
    expected: number,
    fps: number,
    playing: boolean
  ): void {
    // A declared sound with no data-duration is scheduled to the end of the composition, and
    // the file may end first. Past its end there is nothing to play, and seeking there every
    // frame would be a seek per picture that lands on silence.
    if (Number.isFinite(element.duration) && expected >= element.duration) {
      if (!element.paused) element.pause()
      return
    }

    element.playbackRate = playbackRateFor(speed)
    if (playing && element.paused) void element.play().catch(() => {})
    if (!playing && !element.paused) element.pause()

    if (element.seeking) return
    // Paused, the element is being positioned rather than corrected, so it is pinned to
    // the frame: a play from here has to start at the right sample, not 80ms into it.
    const tolerance = playing ? DRIFT_TOLERANCE_SECONDS : 0.5 / fps
    if (Math.abs(element.currentTime - expected) <= tolerance) return
    try {
      element.currentTime = expected
    } catch {
      // Before metadata, a seek throws; the next frame retries.
    }
  }

  /** The pan law's two channel gains, from the routing (`panGains`). */
  #setPan(source: SourceNodes, pan: { left: number; right: number }): void {
    source.left.gain.value = clamp(finite(pan.left, 1), 0, 2)
    source.right.gain.value = clamp(finite(pan.right, 1), 0, 2)
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
        source.output.disconnect()
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
    // Keyed by element, so evicting one of an asset's elements drops only its own node. An
    // earlier version keyed by asset and would have silenced the element still playing — a
    // sound stopping for a reason nothing in the audio path could explain.
    const key = sourceKey(entry.assetId, entry.slot)
    const source = this.#sources.get(key)
    if (!source) return
    source.output.disconnect()
    source.gain.disconnect()
    source.source.disconnect()
    this.#sources.delete(key)
  }
}
