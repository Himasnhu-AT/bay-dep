/**
 * The timeline's audio, expressed as one ffmpeg filter graph.
 *
 * The order of the chain is the whole correctness story, and it is not the obvious one.
 * Fades are properties of the *item*, so they are applied after the item's own trim and
 * speed change but before the export range is clipped out of it — otherwise exporting the
 * back half of a clip produces a fade-in at the wrong place, or none at all. Delay comes
 * last, because until then every stream is still in its own local time.
 */

import type { Item, Project, Timeline } from '@shared/project'
import { US_PER_SECOND, effectiveSpeed, findAsset, sourceTimeAt } from '@shared/project'
import type { CompositionSound } from '@shared/composition'
import { audibleSpan, itemAudioGainAt } from '@shared/audio-gain'
import { volumeMayBeAudible } from '@shared/keyframes'
import { scheduleCompositionSounds, type ScheduledSound } from '@shared/composition-audio'

export interface AudioGraph {
  /** One `-i` per entry, in order; the filter labels index into this. */
  inputs: string[]
  /** The `-filter_complex` string. */
  filter: string
  /** The label to `-map`. */
  outputLabel: string
}

/** Everything downstream of the first filter speaks this, so `amix` never has to convert. */
const COMMON_FORMAT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'

/**
 * `atempo` accepts 0.5–2.0 and nothing else, so a 4× clip needs two stages and a 0.25× clip
 * needs two the other way. Silently clamping would change the pitch of the result without
 * saying so.
 */
function atempoChain(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0 || speed === 1) return []
  const stages: string[] = []
  let remaining = speed
  while (remaining > 2) {
    stages.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.5) {
    stages.push('atempo=0.5')
    remaining *= 2
  }
  if (Math.abs(remaining - 1) > 1e-6) stages.push(`atempo=${remaining.toFixed(6)}`)
  return stages
}

function seconds(value: number): string {
  return value.toFixed(6)
}

interface Candidate {
  item: Item
  path: string
  /**
   * Frames in which the item is *heard* inside the export range — its own span widened into
   * transition handles by `audibleSpan`, then clipped to the range. Wider than the item on a
   * dissolve: the outgoing clip sounds past its end and the incoming one before its start.
   */
  startFrame: number
  endFrame: number
}

function candidates(
  project: Project,
  timeline: Timeline,
  fromFrame: number,
  toFrameExclusive: number
): Candidate[] {
  const out: Candidate[] = []
  for (const track of timeline.tracks) {
    // A muted track is muted whichever kind it is — a video track carries its clips' sound
    // too, and dropping that would lose the dialogue in most real edits.
    if (track.muted) continue
    for (const item of track.items) {
      const asset = findAsset(project, item.assetId)
      if (!asset || !asset.path || !asset.hasAudio) continue
      // An asset whose probe failed still lists and can still sit on a timeline, but ffmpeg
      // will refuse to open it — and one bad input fails the whole `amix`, which would cost
      // the export every other clip's audio. The preview engine skips these for the same
      // reason (`audio.ts` checks `asset.error` in the same walk); export must agree, or the
      // file gets audio the user never heard.
      if (asset.error) continue
      // Not `item.volume`: with volume keys that is not what plays, and a clip keyed up from 0
      // would be dropped from the file while the preview played it.
      if (!volumeMayBeAudible(item)) continue
      // A picture whose sound was detached plays none: its linked audio item is the one input
      // that sound is decoded from. Skipped here, not merely enveloped to zero, so the file is not
      // opened a second time to contribute silence.
      if (item.audioDetached) continue
      const span = audibleSpan(project, timeline, item)
      const startFrame = Math.max(span.firstFrame, fromFrame)
      const endFrame = Math.min(span.endFrame, toFrameExclusive)
      if (endFrame <= startFrame) continue
      out.push({ item, path: asset.path, startFrame, endFrame })
    }
  }
  return out
}

/**
 * The sounds HTML compositions declare, by asset id — as main's `inspectComposition` reports
 * them, so only files that exist and decode. Read from the composition file at export time
 * rather than stored on the asset, because the picture is rendered from the live file too, and
 * a sound list snapshotted at import would disagree with it after the first edit.
 */
export type CompositionSounds = ReadonlyMap<string, readonly CompositionSound[]>

/** One point of a gain envelope: seconds from the start of the export, and a linear gain. */
export interface GainPoint {
  t: number
  gain: number
}

interface SoundCandidate {
  entry: ScheduledSound
  /** Timeline seconds heard inside the export range. */
  startSeconds: number
  endSeconds: number
  envelope: GainPoint[]
}

/**
 * A declared sound's gain across `firstFrame..lastFrame`, sampled once per frame from the one
 * gain function preview also uses, then reduced to the points where the slope changes.
 *
 * Sampled rather than translated into `afade` names on purpose: a fade and a transition ramp
 * are both linear per frame, so the samples are exact and the reduction loses nothing, while
 * any named ffmpeg curve would only resemble the preview's — and diverge in exactly the middle
 * of a cross-fade, where both sides sound fine alone.
 */
export function soundEnvelope(
  project: Project,
  timeline: Timeline,
  item: Item,
  soundVolume: number,
  fromFrame: number,
  firstFrame: number,
  lastFrame: number
): GainPoint[] {
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const samples: GainPoint[] = []
  for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
    samples.push({
      t: (frame - fromFrame) / fps,
      gain: itemAudioGainAt(project, timeline, item, frame) * soundVolume
    })
  }
  // Keep the ends and every corner. A point is dropped only when it lies on the line through
  // its neighbours, which is what makes a 600-frame hold one segment instead of 600.
  return samples.filter((point, index) => {
    const before = samples[index - 1]
    const after = samples[index + 1]
    if (!before || !after) return true
    const slopeIn = (point.gain - before.gain) / (point.t - before.t)
    const slopeOut = (after.gain - point.gain) / (after.t - point.t)
    return Math.abs(slopeIn - slopeOut) > 1e-9
  })
}

/**
 * An envelope as an ffmpeg `volume` expression in `t`, the stream's own seconds —
 * piecewise-linear between the points, holding the last one after.
 *
 * Written as nested `if(lt(t,…))` so it evaluates in one pass per audio frame, and in a form
 * that is also valid arithmetic once `if` and `lt` are given meaning, which is how the tests
 * check it: by evaluating it, not by pattern-matching its text.
 */
export function volumeExpression(points: readonly GainPoint[]): string {
  const num = (value: number): string => value.toFixed(6)
  const last = points[points.length - 1]
  if (!last) return '0'
  let expression = num(last.gain)
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const ramp =
      a.gain === b.gain
        ? num(a.gain)
        : `${num(a.gain)}+${num(b.gain - a.gain)}*(t-${num(a.t)})/${num(b.t - a.t)}`
    expression = `if(lt(t,${num(b.t)}),${ramp},${expression})`
  }
  return expression
}

function soundCandidates(
  project: Project,
  timeline: Timeline,
  fromFrame: number,
  toFrameExclusive: number,
  sounds: CompositionSounds
): SoundCandidate[] {
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const rangeStart = fromFrame / fps
  const rangeEnd = toFrameExclusive / fps
  const out: SoundCandidate[] = []
  for (const track of timeline.tracks) {
    // Muted governs sound for every kind of track, compositions included.
    if (track.muted) continue
    for (const item of track.items) {
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.kind !== 'html' || asset.error) continue
      const declared = sounds.get(asset.id)
      if (!declared || declared.length === 0) continue
      if (!volumeMayBeAudible(item)) continue
      const schedule = scheduleCompositionSounds(
        item,
        audibleSpan(project, timeline, item),
        asset.durationUs / US_PER_SECOND,
        declared,
        fps
      )
      for (const entry of schedule) {
        const startSeconds = Math.max(entry.startSeconds, rangeStart)
        const endSeconds = Math.min(entry.endSeconds, rangeEnd)
        if (!(endSeconds > startSeconds)) continue
        const envelope = soundEnvelope(
          project,
          timeline,
          item,
          entry.sound.volume,
          fromFrame,
          Math.floor(startSeconds * fps),
          // The last frame heard, not the first one after: a sample at the end frame would read
          // the gain of a frame the sound never reaches — zero, past the clip — and ramp the
          // final frame down to it.
          Math.max(Math.floor(startSeconds * fps), Math.ceil(endSeconds * fps) - 1)
        )
        // Silent throughout — a zero volume, or a stretch wholly inside a dip — costs a decode
        // and contributes nothing.
        if (envelope.every((point) => point.gain <= 0)) continue
        out.push({ entry, startSeconds, endSeconds, envelope })
      }
    }
  }
  return out
}

/**
 * Returns null when the timeline has no audible audio in the range — the caller then knows
 * there is nothing to mux, which is different from failing to build a graph.
 *
 * `sounds` carries what each HTML composition on the timeline declares; without it a
 * composition contributes no audio, which is what it did before compositions could.
 */
export function buildAudioGraph(
  project: Project,
  timeline: Timeline,
  fromFrame: number,
  toFrameExclusive: number,
  sounds: CompositionSounds = new Map()
): AudioGraph | null {
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const found = candidates(project, timeline, fromFrame, toFrameExclusive)
  const declared = soundCandidates(project, timeline, fromFrame, toFrameExclusive, sounds)
  if (found.length === 0 && declared.length === 0) return null

  const inputs: string[] = []
  const chains: string[] = []
  const labels: string[] = []

  // A clip: read exactly the source it is heard over, bring it to speed, put it in place, then
  // apply the shared gain as an envelope in export seconds — the same function the preview's
  // gain nodes are driven by, sampled per frame. This used to be `volume` plus two `afade`s,
  // which carried the fades and the level but no transition at all: a dissolve was a hard cut
  // in every exported file while the preview cross-faded it, and the `transition-audio` probe
  // measures the preview, so nothing said so.
  found.forEach((candidate, index) => {
    const { item } = candidate
    const speed = effectiveSpeed(item.speed)
    // Source seconds at the first heard frame — through `sourceTimeAt`, the same mapping the
    // preview seeks with, so preview and export cannot drift apart the way transition gain once
    // did. Before `from` this reads the handle a transition was resolved against;
    // `resolveTransition` only grants a window the footage can cover, so this is non-negative by
    // construction, and clamped only so a malformed item cannot hand ffmpeg a negative start.
    const sourceStart = Math.max(0, sourceTimeAt(item, candidate.startFrame, fps) / US_PER_SECOND)
    const heard = (candidate.endFrame - candidate.startFrame) / fps

    const steps: string[] = [COMMON_FORMAT]
    steps.push(`atrim=start=${seconds(sourceStart)}:duration=${seconds(heard * speed)}`)
    steps.push('asetpts=N/SR/TB')
    steps.push(...atempoChain(speed))
    const delayMs = Math.round(((candidate.startFrame - fromFrame) / fps) * 1000)
    if (delayMs > 0) steps.push(`adelay=${delayMs}:all=1`)

    // Last, because `t` inside `volume` is the stream's own clock, and only after `adelay` is
    // that the export's — the clock the envelope is written in.
    const envelope = soundEnvelope(
      project,
      timeline,
      item,
      1,
      fromFrame,
      candidate.startFrame,
      candidate.endFrame - 1
    )
    const first = envelope[0]?.gain ?? 0
    const constant = envelope.every((point) => point.gain === first)
    if (!constant) steps.push(`volume='${volumeExpression(envelope)}':eval=frame`)
    else if (first !== 1) steps.push(`volume=${first.toFixed(6)}`)

    const label = `a${index}`
    inputs.push(candidate.path)
    chains.push(`[${index}:a]${steps.join(',')}[${label}]`)
    labels.push(label)
  })

  // A composition's declared sounds: the same trim → speed → delay shape as a clip, with the
  // gain applied last, as an envelope in export seconds. Last because `t` inside `volume` is
  // the stream's own clock, and only after `adelay` is that clock the export's.
  for (const candidate of declared) {
    const index = inputs.length
    const { entry } = candidate
    const mediaStart = entry.mediaStartSeconds + (candidate.startSeconds - entry.startSeconds) * entry.speed
    const mediaDuration = (candidate.endSeconds - candidate.startSeconds) * entry.speed

    const steps: string[] = [COMMON_FORMAT]
    steps.push(`atrim=start=${seconds(mediaStart)}:duration=${seconds(mediaDuration)}`)
    steps.push('asetpts=N/SR/TB')
    steps.push(...atempoChain(entry.speed))
    const delayMs = Math.round((candidate.startSeconds - fromFrame / fps) * 1000)
    if (delayMs > 0) steps.push(`adelay=${delayMs}:all=1`)
    const constant = candidate.envelope.every((p) => p.gain === candidate.envelope[0]?.gain)
    steps.push(
      constant
        ? `volume=${(candidate.envelope[0]?.gain ?? 0).toFixed(6)}`
        : `volume='${volumeExpression(candidate.envelope)}':eval=frame`
    )

    const label = `a${index}`
    inputs.push(entry.sound.path)
    chains.push(`[${index}:a]${steps.join(',')}[${label}]`)
    labels.push(label)
  }

  const mixLabel = 'aout'
  const mixed = 'amixed'
  if (labels.length === 1) {
    const only = labels[0]!
    chains.push(`[${only}]anull[${mixed}]`)
  } else {
    // `normalize=0` matters: amix's default divides by the input count, so a timeline with
    // eight clips would export at an eighth of the volume the user monitored.
    chains.push(
      `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0[${mixed}]`
    )
  }

  // **`apad` is why an export gets the frame count it asked for.** Both callers cut this graph
  // with `-t framesTotal/fps`, and `-t` is a maximum, not a minimum: when the last clip's audio
  // runs out before the last video frame — which it does whenever a source's audio stream is
  // fractionally shorter than its container, i.e. constantly — the track came out short. The
  // mux then ran `-shortest` and trimmed the *video* to match, so a 1438-frame export produced
  // a 1437-frame file. It cost exactly one frame and only ever the last one, which is why it
  // read as a rounding curiosity rather than as audio deciding how long the picture is.
  //
  // Padding with silence makes the graph at least as long as asked; `-t` then makes it exactly
  // that. The two streams agree by construction instead of by luck, and `-shortest` has nothing
  // left to trim.
  chains.push(`[${mixed}]apad[${mixLabel}]`)

  return { inputs, filter: chains.join(';'), outputLabel: mixLabel }
}
