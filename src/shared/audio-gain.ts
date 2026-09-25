/**
 * How loud one item is at one timeline frame — the one implementation preview and export share.
 *
 * Shared rather than renderer-only because export runs in main, and "preview and export must
 * share the gain curve, not merely agree about it": two copies of a gain curve are re-decided
 * independently the first time either is edited, and both sound fine in isolation.
 *
 * **Scope.** Every source of timeline sound is scaled by this: clips in the preview
 * (`audioRoutingAt` in `engine/audio.ts`) and in export (`main/export/audio-graph.ts`, which
 * samples it per frame into a `volume` envelope), and HTML compositions' declared sounds on
 * both sides. It carries volume, fades, transitions, J/L-cut offsets and ducking — the whole
 * of "how loud is this item here" — so there is no second place for any of them to be decided.
 */

import type { Frames, Item, Project, Timeline, TransitionKind } from './project'
import {
  fadeGainAt,
  findAsset,
  handlesFor,
  itemEnd,
  resolveTransition,
  trackAudible,
  transitionAtFrame
} from './project'
import { animatedVolumeAt, volumeMayBeAudible } from './keyframes'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The per-channel gains `pan` puts on a clip's stereo sound: `left` multiplies the left channel,
 * `right` the right. The one pan law — the preview sets its two channel gain nodes from this and
 * export writes it into a `pan` filter, so the two cannot be re-decided apart.
 *
 * **Constant power, unity at centre, no fold-over.** With x = (pan + 1) / 2:
 * left = √2·cos(x·π/2), right = √2·sin(x·π/2). So left² + right² = 2 at every position — a
 * dual-mono dialogue clip (the commonest thing panned) keeps its loudness as it moves — and centre
 * is exactly 1/1, so every clip written before pan existed sounds exactly as it did. Hard left is
 * +3 dB on the left channel and silence on the right; half left (−0.5) is +2.3 dB / −5.3 dB.
 *
 * Why not Web Audio's `StereoPannerNode`: on stereo input it folds the attenuated side *into* the
 * other channel, which for correlated material reaches +6 dB at the extreme and is a curve ffmpeg
 * has no filter for — it could only be imitated, and imitations diverge. A gain per channel is
 * exact on both sides.
 *
 * Stereo sources pan as a balance: the side panned away from is attenuated, never moved across.
 * A mono source is up-mixed to two identical channels before this (Web Audio's speaker up-mix;
 * ffmpeg's `aformat` to stereo), so it pans as a point source.
 *
 * A non-finite pan is centre; anything outside −1..1 is clamped.
 */
export function panGains(pan: number | undefined | null): { left: number; right: number } {
  const p = typeof pan === 'number' && Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0
  // Exact at centre: √2·cos(π/4) is 1.0000000000000002, and a gain that is not exactly 1 would put
  // a pan filter on every unpanned clip in every export.
  if (p === 0) return { left: 1, right: 1 }
  const angle = ((p + 1) / 2) * (Math.PI / 2)
  const left = Math.SQRT2 * Math.cos(angle)
  const right = Math.SQRT2 * Math.sin(angle)
  // cos(π/2) is 6e-17, not 0: hard left/right must silence the other side exactly.
  return { left: p === 1 ? 0 : left, right: p === -1 ? 0 : right }
}

/**
 * What the two clips' audio should be doing at `progress`.
 *
 * A transition that shows both pictures and plays one is the most audible defect this feature
 * can have, and the mapping is a judgement rather than a derivation, so it is stated here:
 *
 * - **Dissolve, wipe, push, slide, iris — cross-fade.** The picture may wipe or slide, but a
 *   hard audio cut in the middle of a two-second wipe sounds like a mistake. Every NLE
 *   cross-fades sound under a visual transition of any kind.
 * - **Dip to black or white — dip through silence.** The visual passes through a solid colour
 *   at the midpoint and the sound passes through nothing, which is what a dip *means*. Both
 *   gains reach 0 at exactly 0.5, so the halves meet where the picture's halves meet.
 *
 * Linear rather than equal-power. Equal-power (`sqrt`) holds perceived loudness better across
 * a long cross-fade, and for transitions of a second or two linear is what editors expect and
 * what matches the picture's own linear alpha — a sound that stays loud while the image is
 * half gone reads as out of sync with it.
 *
 * Moved here from `engine/transitions.ts`, which re-exports it, so export can reach it.
 */
export function transitionAudioGains(
  kind: TransitionKind,
  progress: number
): { from: number; to: number } {
  const p = clamp01(progress)
  if (kind === 'dip-to-black' || kind === 'dip-to-white') {
    // Silence at the midpoint, matching the picture being fully at the dip colour.
    return { from: Math.max(0, 1 - p * 2), to: Math.max(0, p * 2 - 1) }
  }
  return { from: 1 - p, to: p }
}

/**
 * An item's J/L-cut offsets as they will actually sound: what was asked for, clamped to what
 * the source and the timeline allow, with the reason for every clamp.
 *
 * Three limits, each reported rather than silently applied, because a J-cut that quietly
 * became 4 frames instead of 15 is a control that does not do what it says:
 *
 * - **Handles.** A lead reads source from before the in-point and a trail from after the
 *   out-point — the same footage a transition spends (`handlesFor`). There is nothing to play
 *   past either end of the file.
 * - **Frame 0.** A lead cannot start before the timeline does.
 * - **A transition on that cut.** A transition already carries this clip's sound across the
 *   cut, centred on it, with its own cross-fade. Honouring both would sound at full level
 *   before the window and then drop to the transition's ramp inside it — a hole. So the
 *   transition wins at that end, as it does over the item's own fade.
 *
 * Offsets are whole frames, non-negative; anything else reads as 0.
 */
export interface AudioOffsets {
  leadFrames: Frames
  trailFrames: Frames
  /** Why an offset is smaller than the one stored, one sentence each. Empty when none is. */
  clamped: string[]
}

function wholeFrames(value: unknown): Frames {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return n > 0 ? n : 0
}

export function resolveAudioOffsets(project: Project, timeline: Timeline, item: Item): AudioOffsets {
  let leadFrames = wholeFrames(item.audioLeadFrames)
  let trailFrames = wholeFrames(item.audioTrailFrames)
  const clamped: string[] = []
  if (leadFrames === 0 && trailFrames === 0) return { leadFrames, trailFrames, clamped }

  for (const transition of timeline.transitions ?? []) {
    if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue
    const resolved = resolveTransition(project, timeline, transition)
    if (!resolved) continue
    if (resolved.to.id === item.id && leadFrames > 0) {
      clamped.push(
        `the ${leadFrames}-frame audio lead is ignored: a transition on this clip's in-point ` +
          `already carries its sound across that cut`
      )
      leadFrames = 0
    }
    if (resolved.from.id === item.id && trailFrames > 0) {
      clamped.push(
        `the ${trailFrames}-frame audio trail is ignored: a transition on this clip's out-point ` +
          `already carries its sound across that cut`
      )
      trailFrames = 0
    }
  }

  const handles = handlesFor(findAsset(project, item.assetId), item, timeline.fps)
  if (leadFrames > handles.before) {
    clamped.push(
      `the audio lead is ${handles.before} frames, not ${leadFrames}: the source has only ` +
        `${handles.before} frames before this clip's in-point`
    )
    leadFrames = handles.before
  }
  if (leadFrames > item.from) {
    clamped.push(
      `the audio lead is ${item.from} frames, not ${leadFrames}: the clip starts at frame ` +
        `${item.from} and sound cannot start before the timeline does`
    )
    leadFrames = item.from
  }
  if (trailFrames > handles.after) {
    clamped.push(
      `the audio trail is ${handles.after} frames, not ${trailFrames}: the source has only ` +
        `${handles.after} frames after this clip's out-point`
    )
    trailFrames = handles.after
  }
  return { leadFrames, trailFrames, clamped }
}

/**
 * The frames over which `item` can make sound: its own span, widened by its J/L-cut offsets
 * and by any transition that straddles either of its ends.
 *
 * A transition's window is centred on the cut, so the incoming clip must sound before its own
 * `from` and the outgoing one past its own end — both reading handle material. A schedule
 * clipped to the item's own span would hard-cut the outgoing sound at the cut while its
 * picture is still half visible. A J-cut's lead and an L-cut's trail read the same handles;
 * `resolveAudioOffsets` sets an offset aside where a transition holds that end, so the two
 * never both widen one side.
 */
export function audibleSpan(
  project: Project,
  timeline: Timeline,
  item: Item
): { firstFrame: Frames; endFrame: Frames } {
  const offsets = resolveAudioOffsets(project, timeline, item)
  let firstFrame = item.from - offsets.leadFrames
  let endFrame = itemEnd(item) + offsets.trailFrames
  for (const transition of timeline.transitions ?? []) {
    if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue
    const resolved = resolveTransition(project, timeline, transition)
    if (!resolved) continue
    if (resolved.to.id === item.id) firstFrame = Math.min(firstFrame, resolved.firstFrame)
    if (resolved.from.id === item.id) endFrame = Math.max(endFrame, resolved.lastFrame + 1)
  }
  return { firstFrame, endFrame }
}

/**
 * How far a duck is pulled down at `frame` by one key span, 0 (not at all) to 1 (fully).
 *
 * Linear in gain, with the attack *ending* where the key starts and the release *starting*
 * where it ends. Two choices, both deliberate:
 *
 * - **The attack anticipates.** A signal-driven sidechain cannot look ahead, so it ducks after
 *   the first syllable has already been masked; an editor riding the fader by hand dips the
 *   music just before the line. The key's timing is known here, so this does what the editor
 *   does.
 * - **Linear in gain, not in dB.** Export turns the envelope into a piecewise-linear `volume`
 *   expression and keeps only its corners; a linear ramp is four corners per duck, a dB ramp
 *   one point per frame of every ramp — a nested expression thousands deep on a long bed.
 */
export function duckDepth(
  frame: Frames,
  span: { firstFrame: Frames; endFrame: Frames },
  attackFrames: Frames,
  releaseFrames: Frames
): number {
  if (frame >= span.firstFrame && frame < span.endFrame) return 1
  if (attackFrames > 0 && frame >= span.firstFrame - attackFrames && frame < span.firstFrame) {
    return (frame - (span.firstFrame - attackFrames)) / attackFrames
  }
  if (releaseFrames > 0 && frame >= span.endFrame && frame < span.endFrame + releaseFrames) {
    return (span.endFrame + releaseFrames - frame) / releaseFrames
  }
  return 0
}

/** The most a duck may take off. Past this it is a mute, and there is a control for that. */
export const MAX_DUCK_DB = 40

/**
 * The duck multiplier on `item` at `frame`: 1 when it is not ducked, down to
 * `10^(−amountDb/20)` while any clip on the key track is sounding.
 *
 * **Keyed on presence, not on signal level — the decision this feature turns on.** A classic
 * sidechain follows the key's level. That cannot be one implementation: the preview is Web
 * Audio, whose `DynamicsCompressorNode` has no sidechain input, so it would need an analyser
 * loop polled at the picture rate; export would be ffmpeg's `sidechaincompress`, whose
 * detector, knee and time constants are its own. Two detectors are two answers, and "preview
 * and export must share the gain curve, not merely agree about it". Presence is a pure
 * function of the timeline, so preview and export call this same function and cannot
 * disagree — and it is what an editor does by hand: pull the music down under the line, not
 * under each syllable. The cost, stated: a pause inside a dialogue clip stays ducked.
 *
 * A key is a clip on the key track that can sound — an asset with audio, readable, volume
 * above 0 — over its `audibleSpan`, so a key's own J-cut lead ducks the music too. A muted key
 * track ducks nothing: ducking exists to make the key heard, and a dip under something muted
 * is a hole under nothing. Overlapping keys do not stack; the deepest wins.
 */
export function duckGainAt(project: Project, timeline: Timeline, item: Item, frame: Frames): number {
  const duck = item.duck
  if (!duck) return 1
  const amount = Number.isFinite(duck.amountDb) ? Math.min(MAX_DUCK_DB, duck.amountDb) : 0
  if (!(amount > 0)) return 1
  const key = timeline.tracks.find((track) => track.id === duck.keyTrackId)
  if (!key || !trackAudible(timeline.tracks, key)) return 1
  const attack = wholeFrames(duck.attackFrames)
  const release = wholeFrames(duck.releaseFrames)

  let depth = 0
  for (const keyItem of key.items) {
    if (keyItem.id === item.id) continue
    const asset = findAsset(project, keyItem.assetId)
    if (!asset || asset.error || !asset.hasAudio || !volumeMayBeAudible(keyItem) || keyItem.audioDetached) continue
    depth = Math.max(depth, duckDepth(frame, audibleSpan(project, timeline, keyItem), attack, release))
  }
  return 1 - depth * (1 - 10 ** (-amount / 20))
}

/**
 * The transition over `item` at `frame`, if one of its own cuts has one there.
 *
 * Asked per item rather than through `transitionAtFrame`, which answers with the *first*
 * transition at the frame anywhere on the timeline. That was enough while one cut at a time could
 * carry sound; with detached audio a picture dissolve and the audio cross-fade under it sit at the
 * same frames on two tracks, and the audio items' gain must come from their own transition, not
 * from whichever of the two happens to be listed first.
 */
export function transitionOfItemAt(
  project: Project,
  timeline: Timeline,
  item: Item,
  frame: Frames
): ReturnType<typeof transitionAtFrame> {
  for (const transition of timeline.transitions ?? []) {
    if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue
    const resolved = resolveTransition(project, timeline, transition)
    if (!resolved) continue
    if (frame < resolved.firstFrame || frame > resolved.lastFrame) continue
    const span = resolved.lastFrame - resolved.firstFrame + 1
    const progress = span <= 1 ? 1 : (frame - resolved.firstFrame) / (span - 1)
    return { resolved, progress: Math.max(0, Math.min(1, progress)) }
  }
  return null
}

/** The fader on `trackId`: 0..2, unity when absent, and a non-finite value is unity rather than silence. */
export function trackVolume(timeline: Timeline, trackId: string): number {
  const level = timeline.tracks.find((track) => track.id === trackId)?.volume
  return typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(2, level)) : 1
}

/**
 * The per-channel gains for an item's sound: its own pan, then its track's. Each is the same
 * constant-power law (`panGains`) and the two multiply per channel — the preview's channel gains
 * and export's `pan` filters are both written from this, so they cannot disagree.
 */
export function routedPanGains(timeline: Timeline, item: Pick<Item, 'pan' | 'trackId'>): { left: number; right: number } {
  const own = panGains(item.pan)
  const track = panGains(timeline.tracks.find((candidate) => candidate.id === item.trackId)?.pan)
  return { left: own.left * track.left, right: own.right * track.right }
}

/**
 * `item`'s gain at `frame`: its volume, times its track's fader, times its fade envelope, times any transition over it,
 * times its duck.
 *
 * Independent things multiply, and collapsing any two would make one unreachable while
 * the other is set — with one exception, which is a rule rather than an accident: **where a
 * transition and the item's own fade meet, the transition wins and the fade at that end is
 * ignored.** They express the same intent at the same place, and multiplied, a 12-frame
 * fade-out against a dissolve's ramp dips to near-silence mid-window — a hole neither side
 * asked for. It lives here, in the function both sides call, so it is decided once.
 *
 * With a J/L cut the fades belong to the *sound's* edges, not the picture's: a lead starting at
 * full level clicks in under the previous shot, which is exactly where the 3–4 frame edge fade
 * a J-cut needs goes.
 *
 * Volume is clamped to 0..2 as the inspector allows; a non-finite one is treated as 1, since
 * one NaN would otherwise silence the item with no error anywhere. With volume keyframes the
 * volume is theirs at this frame (`animatedVolumeAt`), so a ride is sampled here and nowhere else:
 * the preview's gain nodes and export's per-frame envelope both read it through this function.
 */
export function itemAudioGainAt(
  project: Project,
  timeline: Timeline,
  item: Item,
  frame: Frames
): number {
  // A picture whose sound was detached onto an audio item plays none of its own: that item is the
  // one place the sound comes from, in preview and in export alike.
  if (item.audioDetached) return 0
  const level = animatedVolumeAt(item, frame)
  const volume = Number.isFinite(level) ? Math.max(0, Math.min(2, level)) : 1
  if (volume === 0) return 0

  const active = transitionOfItemAt(project, timeline, item, frame)
  let transitionGain = 1
  let fadeIn = item.fadeInFrames
  let fadeOut = item.fadeOutFrames
  let inTransition = false
  if (active) {
    const gains = transitionAudioGains(active.resolved.transition.kind, active.progress)
    if (active.resolved.from.id === item.id) {
      transitionGain = gains.from
      fadeOut = 0
      inTransition = true
    } else if (active.resolved.to.id === item.id) {
      transitionGain = gains.to
      fadeIn = 0
      inTransition = true
    }
  }

  const offsets = resolveAudioOffsets(project, timeline, item)
  const soundFrom = item.from - offsets.leadFrames
  const soundEnd = itemEnd(item) + offsets.trailFrames
  // Outside the item's sound span only a transition can make it sound, and there the fade at
  // that end has just been set aside.
  if (!inTransition && (frame < soundFrom || frame >= soundEnd)) return 0
  const fade = fadeGainAt(
    {
      ...item,
      from: soundFrom,
      durationInFrames: soundEnd - soundFrom,
      fadeInFrames: fadeIn,
      fadeOutFrames: fadeOut
    },
    frame
  )
  return volume * trackVolume(timeline, item.trackId) * fade * transitionGain * duckGainAt(project, timeline, item, frame)
}
