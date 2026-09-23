/**
 * `edit_item`'s sound-finishing fields — J/L cuts and ducking — validated, and reported back as
 * they will actually sound.
 *
 * Kept beside `adjustments.ts` rather than inline in `editItem` so the rules live in one place
 * the inspector and `inspect_item` also read from. Every gain decision itself is in
 * `@shared/audio-gain`; this only turns arguments into fields and fields into sentences.
 *
 * Two conventions, both from the rest of this surface:
 * - **Refuse what cannot do anything.** A J-cut on a clip with no sound would read back as set
 *   and change nothing, which is the shape of a control that does not do what it says.
 * - **Store what was asked, report what resolves.** Like a transition's duration, a lead is
 *   clamped when it is *read*, to the handles the clip has now; a later slip that gives it more
 *   footage gives the J-cut its full length back. The clamp is reported every time it applies.
 */

import type { AudioDuck, Item, Project, Timeline, Track } from '@shared/project'
import { findAsset } from '@shared/project'
import { MAX_DUCK_DB, resolveAudioOffsets } from '@shared/audio-gain'
import { fail, resolveTrack } from './helpers'

type Patch = Pick<Item, 'audioLeadFrames' | 'audioTrailFrames' | 'duck'>

function wholeFramesArg(name: string, value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) {
    fail(`${name} must be a whole number of frames, 0 or more; got ${JSON.stringify(value)}.`)
  }
  return n
}

/** The sound-finishing part of an `edit_item` patch. Only keys present in `args` appear. */
export function audioFinishPatch(
  args: Record<string, unknown>,
  item: Item,
  track: Track,
  project: Project,
  timeline: Timeline
): Patch {
  const patch: Patch = {}
  const touches =
    args.audioLeadFrames !== undefined || args.audioTrailFrames !== undefined || args.duck !== undefined
  if (!touches) return patch

  const asset = findAsset(project, item.assetId)
  // Clearing is always allowed — there must be a way to remove a field whatever the asset.
  const clearing =
    (args.audioLeadFrames === undefined || Number(args.audioLeadFrames) === 0) &&
    (args.audioTrailFrames === undefined || Number(args.audioTrailFrames) === 0) &&
    (args.duck === undefined || args.duck === null)
  if (!clearing && (!asset || !asset.hasAudio)) {
    fail(
      `Item ${item.id} draws ${asset ? `${asset.name}, which has no audio` : 'a missing asset'}, ` +
        `so a J/L cut or a duck on it would change nothing. These fields apply to clips with sound.`
    )
  }

  if (args.audioLeadFrames !== undefined) {
    const n = wholeFramesArg('audioLeadFrames', args.audioLeadFrames)
    patch.audioLeadFrames = n > 0 ? n : undefined
  }
  if (args.audioTrailFrames !== undefined) {
    const n = wholeFramesArg('audioTrailFrames', args.audioTrailFrames)
    patch.audioTrailFrames = n > 0 ? n : undefined
  }

  if (args.duck !== undefined) {
    if (args.duck === null) {
      patch.duck = undefined
    } else {
      const given = args.duck
      if (typeof given !== 'object' || Array.isArray(given)) {
        fail('`duck` must be { keyTrackId, amountDb, attackFrames, releaseFrames }, or null to remove it.')
      }
      const fields = ['keyTrackId', 'amountDb', 'attackFrames', 'releaseFrames']
      const unknown = Object.keys(given as object).filter((k) => !fields.includes(k))
      if (unknown.length > 0) fail(`duck has no field "${unknown[0]}". The fields are ${fields.join(', ')}.`)
      const g = given as Record<string, unknown>
      const current = item.duck
      const keyGiven = g.keyTrackId ?? current?.keyTrackId
      if (keyGiven === undefined) {
        fail(
          'duck needs keyTrackId — the track to duck under, usually the dialogue. Tracks on this ' +
            `timeline: ${timeline.tracks.map((t) => `${t.name} (${t.id})`).join(', ')}.`
        )
      }
      const key = resolveTrack(String(keyGiven))
      if (key.id === track.id) {
        fail(
          `Item ${item.id} is on ${key.name}, so it cannot duck under its own track. Name the ` +
            `track whose sound it should make room for.`
        )
      }
      const fps = timeline.fps > 0 ? timeline.fps : 30
      const amountDb = g.amountDb === undefined ? (current?.amountDb ?? 6) : Number(g.amountDb)
      if (!Number.isFinite(amountDb) || amountDb <= 0 || amountDb > MAX_DUCK_DB) {
        fail(
          `duck.amountDb must be a number of dB above 0 and at most ${MAX_DUCK_DB}; got ` +
            `${JSON.stringify(g.amountDb)}. 6 is a light duck under dialogue, 12 a firm one.`
        )
      }
      const duck: AudioDuck = {
        keyTrackId: key.id,
        amountDb,
        attackFrames:
          g.attackFrames === undefined
            ? (current?.attackFrames ?? Math.round(fps * 0.25))
            : wholeFramesArg('duck.attackFrames', g.attackFrames),
        releaseFrames:
          g.releaseFrames === undefined
            ? (current?.releaseFrames ?? Math.round(fps * 0.5))
            : wholeFramesArg('duck.releaseFrames', g.releaseFrames)
      }
      patch.duck = duck
    }
  }
  return patch
}

/**
 * The item's sound-finishing state as it will sound, for a tool result. Absent when the item
 * has none of it — absence means "not set", which is a different statement from "set to 0".
 */
export function audioFinishReport(
  item: Item,
  project: Project,
  timeline: Timeline
): { report: Record<string, unknown> | null; warnings: string[] } {
  const warnings: string[] = []
  const report: Record<string, unknown> = {}
  if (item.audioLeadFrames || item.audioTrailFrames) {
    const offsets = resolveAudioOffsets(project, timeline, item)
    report.audioLeadFrames = offsets.leadFrames
    report.audioTrailFrames = offsets.trailFrames
    if (offsets.clamped.length > 0) {
      report.audioOffsetsAsked = {
        audioLeadFrames: item.audioLeadFrames ?? 0,
        audioTrailFrames: item.audioTrailFrames ?? 0
      }
      for (const reason of offsets.clamped) warnings.push(`J/L cut: ${reason}.`)
    }
  }
  if (item.duck) {
    report.duck = { ...item.duck }
    const key = timeline.tracks.find((t) => t.id === item.duck?.keyTrackId)
    const keys =
      key?.items.filter((i) => {
        const a = findAsset(project, i.assetId)
        return a && !a.error && a.hasAudio && i.volume > 0
      }) ?? []
    if (!key) {
      warnings.push(`duck: the key track ${item.duck.keyTrackId} no longer exists, so nothing ducks this clip.`)
    } else if (key.muted) {
      warnings.push(`duck: ${key.name} is muted, and a muted key ducks nothing.`)
    } else if (keys.length === 0) {
      warnings.push(
        `duck: ${key.name} has no clips with sound yet, so this clip is not ducked anywhere. It ` +
          `will duck under whatever with sound is placed there.`
      )
    }
  }
  return { report: Object.keys(report).length > 0 ? report : null, warnings }
}
