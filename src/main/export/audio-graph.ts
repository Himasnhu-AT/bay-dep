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
import { US_PER_SECOND, findAsset, itemEnd } from '@shared/project'

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
  /** Frames of the item that fall inside the export range. */
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
      if (item.volume <= 0) continue
      const startFrame = Math.max(item.from, fromFrame)
      const endFrame = Math.min(itemEnd(item), toFrameExclusive)
      if (endFrame <= startFrame) continue
      out.push({ item, path: asset.path, startFrame, endFrame })
    }
  }
  return out
}

/**
 * Returns null when the timeline has no audible audio in the range — the caller then knows
 * there is nothing to mux, which is different from failing to build a graph.
 */
export function buildAudioGraph(
  project: Project,
  timeline: Timeline,
  fromFrame: number,
  toFrameExclusive: number
): AudioGraph | null {
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const found = candidates(project, timeline, fromFrame, toFrameExclusive)
  if (found.length === 0) return null

  const inputs: string[] = []
  const chains: string[] = []
  const labels: string[] = []

  found.forEach((candidate, index) => {
    const { item } = candidate
    const speed = Number.isFinite(item.speed) && item.speed > 0 ? item.speed : 1
    const itemDuration = item.durationInFrames / fps
    const sourceStart = item.sourceStartUs / US_PER_SECOND
    const sourceDuration = itemDuration * speed

    const steps: string[] = [COMMON_FORMAT]
    steps.push(`atrim=start=${seconds(sourceStart)}:duration=${seconds(sourceDuration)}`)
    steps.push('asetpts=N/SR/TB')
    steps.push(...atempoChain(speed))
    if (item.volume !== 1) steps.push(`volume=${item.volume.toFixed(4)}`)

    const fadeIn = item.fadeInFrames / fps
    if (fadeIn > 0) steps.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`)
    const fadeOut = item.fadeOutFrames / fps
    if (fadeOut > 0 && fadeOut < itemDuration) {
      steps.push(`afade=t=out:st=${seconds(itemDuration - fadeOut)}:d=${seconds(fadeOut)}`)
    }

    // Now clip to the exported range. Doing this after the fades is what keeps a partial
    // export's envelope identical to the same moment in a full one.
    const insetStart = (candidate.startFrame - item.from) / fps
    const segment = (candidate.endFrame - candidate.startFrame) / fps
    if (insetStart > 0 || candidate.endFrame < itemEnd(item)) {
      steps.push(`atrim=start=${seconds(insetStart)}:duration=${seconds(segment)}`)
      steps.push('asetpts=N/SR/TB')
    }

    const delayMs = Math.round(((candidate.startFrame - fromFrame) / fps) * 1000)
    if (delayMs > 0) steps.push(`adelay=${delayMs}:all=1`)

    const label = `a${index}`
    inputs.push(candidate.path)
    chains.push(`[${index}:a]${steps.join(',')}[${label}]`)
    labels.push(label)
  })

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
