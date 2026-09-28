/**
 * The speech-editing tools: `set_item_enabled`, `remove_silences`, `switch_speakers`,
 * `level_voices` and `sync_angles`.
 *
 * Every measurement runs in main through bay's own ffmpeg (`media/audio-analysis.ts`) over
 * exactly the source a clip plays — from its in-point, for its duration × speed — and every
 * decision is a pure function in `@shared` (`silences`, `speaker-switch`, `voice-level`,
 * `audio-sync`) with its own tests. This module resolves ids, asks main, and applies the answer
 * through the store as one undo step per call.
 *
 * The four that measure are `selfValidating` rather than `dryRunnable`: their handlers await main,
 * and the executor's store dry run must be synchronous to put the project back. So `validateOnly`
 * reaches each handler, which measures and plans exactly as a real call would and returns before
 * the one store call that applies it — the plan is the answer, and nothing was changed.
 */

import type { AudioResult, AudioSpan } from '@shared/ipc'
import { allItems, findAsset, framesToUs, itemEnd, type Asset, type Item, type Track } from '@shared/project'
import { resolveId, VALIDATE_ONLY } from '@shared/mcp'
import { linkedPartners, withLinked } from '@shared/links'
import { commonSilence, framesRemoved, removalRanges, silenceFrames, SILENCE_DEFAULTS, type AnalysedClip } from '@shared/silences'
import { LEVEL_WINDOW_SEC, planSwitch, SWITCH_DEFAULTS, type MicStats, type SwitchOptions } from '@shared/speaker-switch'
import { DEFAULT_VOICE_LUFS, planVoiceLevel, SILENT_LUFS } from '@shared/voice-level'
import { findSyncOffset, MIN_SYNC_CORRELATION, MIN_SYNC_PEAK_RATIO, SYNC_WINDOW_SEC } from '@shared/audio-sync'
import { bay } from '@/lib/bay'
import { fail, project, store, timeline, ToolError, type Handlers } from './helpers'

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places

function media(): NonNullable<ReturnType<typeof bay>>['media'] {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot analyse audio.')
  return api.media
}

async function measured<T>(what: string, asset: Asset, work: Promise<AudioResult<T>>): Promise<T> {
  const result = await work
  if (!result.ok) throw new ToolError(`${what} failed on "${asset.name}": ${result.error}`)
  return result.value
}

function resolveItemIds(given: readonly unknown[], field: string): { item: Item; track: Track }[] {
  const tl = timeline()
  const known = allItems(tl).map((i) => i.id)
  const out: { item: Item; track: Track }[] = []
  for (const each of given) {
    if (typeof each !== 'string') fail(`${field} must be a list of item ids from read_project.`)
    const resolved = resolveId(each, known)
    if (!resolved.ok) fail(`${field}: ${resolved.error}`)
    const track = tl.tracks.find((t) => t.items.some((i) => i.id === resolved.id))!
    const item = track.items.find((i) => i.id === resolved.id)!
    if (out.some((o) => o.item.id === item.id)) fail(`${field} names ${item.id} twice. Name each clip once.`)
    out.push({ item, track })
  }
  return out
}

function nameOf(item: Item): string {
  return findAsset(project(), item.assetId)?.name ?? item.id
}

/** The asset whose sound a clip plays, or a refusal saying why it has none. */
function audioAsset(item: Item, why: string): Asset & { path: string } {
  const asset = findAsset(project(), item.assetId)
  if (!asset?.path) fail(`Clip ${item.id} has no media file, so it has no sound to ${why}. Pass a clip of a recording.`)
  if (!asset.hasAudio) fail(`"${asset.name}" (clip ${item.id}) has no audio track, so there is nothing to ${why}. Pass the clip that carries the sound.`)
  return asset as Asset & { path: string }
}

/** The source a clip plays over timeline frames [fromFrame, toFrame) of it. */
function sourceSpan(item: Item, fps: number, fromFrame = item.from, toFrame = itemEnd(item)): AudioSpan {
  const speed = Number.isFinite(item.speed) && item.speed > 0 ? item.speed : 1
  return {
    startUs: item.sourceStartUs + Math.round(framesToUs(fromFrame - item.from, fps) * speed),
    durationUs: Math.round(framesToUs(toFrame - fromFrame, fps) * speed)
  }
}

/** The call is a dry run: measure and plan, apply nothing. */
const dryRun = (args: Record<string, unknown>): boolean => args[VALIDATE_ONLY] === true
const DRY_NOTE = 'validateOnly: nothing was changed. Call again without it to apply this.'

const speedOf = (item: Item): number => (Number.isFinite(item.speed) && item.speed > 0 ? item.speed : 1)

function refuseLocked(entries: readonly { item: Item; track: Track }[], what: string): void {
  const locked = entries.filter((e) => e.track.locked)
  if (locked.length === 0) return
  fail(
    `${[...new Set(locked.map((e) => e.track.name))].join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked, so ${what} is refused ` +
      `(${locked.map((e) => e.item.id).join(', ')}). Unlock in the UI first, or leave those clips out.`
  )
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// set_item_enabled
// ---------------------------------------------------------------------------

export function setItemEnabled(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.enabled !== 'boolean') fail('enabled must be true (switch on) or false (switch off).')
  const enabled = args.enabled
  const entries = resolveItemIds((args.itemIds as unknown[]) ?? [], 'itemIds')
  if (entries.length === 0) fail('itemIds is empty, so there is nothing to switch.')
  const tl = timeline()
  const named = entries.map((e) => e.item.id)
  const ids = args.linked === false ? named : withLinked(tl, named)
  const lockedIds = ids.filter((id) => tl.tracks.find((t) => t.items.some((i) => i.id === id))?.locked)
  if (lockedIds.length > 0) {
    const names = [...new Set(lockedIds.map((id) => tl.tracks.find((t) => t.items.some((i) => i.id === id))!.name))]
    fail(
      `${lockedIds.join(', ')} ${lockedIds.length === 1 ? 'is' : 'are'} on locked ${names.length === 1 ? 'track' : 'tracks'} ${names.join(', ')}, ` +
        'so nothing was switched. Unlock in the UI first' + (args.linked === false ? '.' : ', or pass linked: false to leave linked clips alone.')
    )
  }
  const changed = store().setItemsEnabled(ids, enabled)
  const unchanged = ids.filter((id) => !changed.includes(id))
  const alsoLinked = changed.filter((id) => !named.includes(id))
  return {
    enabled,
    changed,
    ...(unchanged.length > 0 ? { unchanged } : {}),
    ...(alsoLinked.length > 0 ? { linkedAlsoChanged: alsoLinked } : {}),
    note:
      changed.length === 0
        ? `Every clip named was already ${enabled ? 'on' : 'off'}; nothing changed.`
        : `${changed.length} clip${changed.length === 1 ? '' : 's'} switched ${enabled ? 'on' : 'off'}` +
          (alsoLinked.length > 0 ? `, including ${alsoLinked.join(', ')}, linked to what you named.` : '.') +
          (enabled ? '' : ' They stay on the timeline; set_item_enabled with enabled: true brings them back.')
  }
}

// ---------------------------------------------------------------------------
// remove_silences
// ---------------------------------------------------------------------------

export async function removeSilences(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const forms = ['itemId', 'itemIds', 'trackId'].filter((k) => args[k] !== undefined)
  if (forms.length !== 1) {
    fail(
      forms.length === 0
        ? 'remove_silences needs itemId (one clip), itemIds (several mics of one conversation) or trackId (every clip on a dialogue track). read_project lists them.'
        : `Pass only one of itemId, itemIds or trackId, not ${forms.join(' and ')}.`
    )
  }
  const tl = timeline()
  const fps = tl.fps
  let entries: { item: Item; track: Track }[]
  if (typeof args.trackId === 'string') {
    const resolved = resolveId(args.trackId, tl.tracks.map((t) => t.id))
    if (!resolved.ok) fail(`${resolved.error} Tracks: ${tl.tracks.map((t) => `${t.name} (${t.kind}, ${t.id})`).join(', ')}.`)
    const track = tl.tracks.find((t) => t.id === resolved.id)!
    entries = track.items
      .filter((item) => !item.disabled && findAsset(project(), item.assetId)?.hasAudio && findAsset(project(), item.assetId)?.path)
      .map((item) => ({ item, track }))
    if (entries.length === 0) fail(`Track ${track.name} has no enabled clip with sound. Pass the track that carries the speech.`)
  } else if (typeof args.itemId === 'string') {
    entries = resolveItemIds([args.itemId], 'itemId')
  } else {
    entries = resolveItemIds((args.itemIds as unknown[]) ?? [], 'itemIds')
    if (entries.length === 0) fail('itemIds is empty. Name the clips that carry the speech.')
  }
  refuseLocked(entries, 'cutting silences out of them')

  const thresholdDb = numberArg(args, 'thresholdDb', SILENCE_DEFAULTS.thresholdDb)
  const minSilenceSec = numberArg(args, 'minSilenceSec', SILENCE_DEFAULTS.minSilenceSec)
  const keepPaddingSec = Math.max(0, numberArg(args, 'keepPaddingSec', SILENCE_DEFAULTS.keepPaddingSec))

  const api = media()
  const analysed: AnalysedClip[] = []
  let found = 0
  for (const { item } of entries) {
    const asset = audioAsset(item, 'search for silences')
    const silences = await measured('Silence detection', asset, api.silences(asset.path, sourceSpan(item, fps), thresholdDb, minSilenceSec))
    found += silences.length
    analysed.push({ clip: item, silent: silenceFrames(item, silences, fps) })
  }
  const common = commonSilence(analysed)
  const ranges = removalRanges(common, keepPaddingSec * fps)
  if (ranges.length === 0) {
    fail(
      found === 0
        ? `No pause of ${minSilenceSec} s or more below ${thresholdDb} dB was found. In a noisy room the pauses sit above that: ` +
            `try thresholdDb ${Math.min(-10, thresholdDb + 5)}. For a fast talker try minSilenceSec ${Math.max(0.1, round(minSilenceSec / 2, 2))}.`
        : common.length === 0
          ? `Each of the ${found} pauses found is filled by another clip's speech, so there is no moment where every clip is silent. ` +
              'Pass the clips one at a time only if cutting one speaker\'s pauses is really what you want (it cuts the others too).'
          : `${common.length} pause${common.length === 1 ? ' was' : 's were'} found, but none is longer than the ${keepPaddingSec} s padding kept on each side. ` +
              `Pass a smaller keepPaddingSec (0.1) or a lower minSilenceSec to cut shorter pauses.`
    )
  }

  const before = tl.tracks.reduce((max, t) => Math.max(max, ...t.items.map(itemEnd)), 0)
  if (dryRun(args)) {
    const frames = framesRemoved(ranges)
    return {
      validateOnly: true,
      removedRanges: ranges.map((r) => ({ ...r, seconds: round((r.toFrame - r.fromFrame) / fps) })),
      rangeCount: ranges.length,
      savedSeconds: round(frames / fps, 1),
      durationBefore: before,
      durationAfter: before - frames,
      settings: { thresholdDb, minSilenceSec, keepPaddingSec },
      note: DRY_NOTE
    }
  }
  const result = store().rippleDeleteRanges(ranges)
  if (!result || result.removedFrames === 0) fail('The silences were found but nothing on the timeline was removed. Check that the tracks are unlocked.')
  const after = timeline()
  const desynced = after.tracks.filter((t) => result.desyncedTrackIds.includes(t.id)).map((t) => ({ id: t.id, name: t.name }))
  const saved = framesRemoved(ranges)
  return {
    removedRanges: ranges.map((r) => ({ ...r, seconds: round((r.toFrame - r.fromFrame) / fps) })),
    rangeCount: ranges.length,
    removedFrames: result.removedFrames,
    savedSeconds: round(saved / fps, 1),
    durationBefore: before,
    durationAfter: after.tracks.reduce((max, t) => Math.max(max, ...t.items.map(itemEnd)), 0),
    settings: { thresholdDb, minSilenceSec, keepPaddingSec },
    ...(desynced.length > 0
      ? {
          desyncedTracks: desynced,
          warning: `${desynced.map((t) => t.name).join(', ')} ${desynced.length === 1 ? 'is' : 'are'} locked and did not move, so ${desynced.length === 1 ? 'it is' : 'they are'} now out of sync. Unlock and undo, then run again.`
        }
      : {}),
    next:
      `${ranges.length} pause${ranges.length === 1 ? '' : 's'} removed, ${round(saved / fps, 1)} s saved. Frames are as they were before the cut ` +
      '(ranges are listed in the original timeline\'s frames). Play a cut or two, or check with preview_frame; undo restores all of them at once.'
  }
}

// ---------------------------------------------------------------------------
// switch_speakers
// ---------------------------------------------------------------------------

interface AngleArg {
  videoItemId: string
  micItemId?: string
}

function micLine(label: string, stats: MicStats): string {
  const threshold = Number.isFinite(stats.thresholdDb) ? `${round(stats.thresholdDb, 1)} dB` : 'none (no voice found)'
  return `${label}: room ${round(stats.floorDb, 1)} dB, speech ${round(stats.speechDb, 1)} dB, threshold ${threshold}, talking ${Math.round(stats.activeShare * 100)}% of the time`
}

export async function switchSpeakers(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = Array.isArray(args.angles) ? (args.angles as AngleArg[]) : []
  if (raw.length < 2) {
    fail(
      'switch_speakers needs at least two angles, one per speaker: [{ videoItemId, micItemId? }, …]. With one camera there is ' +
        'nothing to switch between — punch in with edit_item keyframes instead.'
    )
  }
  const tl = timeline()
  const fps = tl.fps
  const videos = resolveItemIds(raw.map((a) => a?.videoItemId), 'angles[].videoItemId')
  const mics = raw.map((a, index) => (typeof a?.micItemId === 'string' ? resolveItemIds([a.micItemId], `angles[${index}].micItemId`)[0]! : videos[index]!))
  const wide = typeof args.wideItemId === 'string' ? resolveItemIds([args.wideItemId], 'wideItemId')[0]! : null
  const pictures = wide ? [...videos, wide] : videos

  const notVideo = pictures.filter((p) => p.track.kind !== 'video')
  if (notVideo.length > 0) fail(`${notVideo.map((p) => p.item.id).join(', ')} ${notVideo.length === 1 ? 'is' : 'are'} not on a video track. Each angle's videoItemId is the picture; pass the sound as micItemId.`)
  const byTrack = new Map<string, string[]>()
  for (const p of pictures) byTrack.set(p.track.id, [...(byTrack.get(p.track.id) ?? []), p.item.id])
  const shared = [...byTrack.entries()].filter(([, ids]) => ids.length > 1)
  if (shared.length > 0) {
    fail(
      `Angles must be stacked on different video tracks, and ${shared.map(([trackId, ids]) => `${ids.join(' and ')} share ${tl.tracks.find((t) => t.id === trackId)?.name}`).join('; ')}. ` +
        'Move one to its own track (add_track, then edit_item with trackId), then run again.'
    )
  }
  refuseLocked(pictures, 'switching angles')

  const all = [...pictures, ...mics]
  const spanFrom = Math.max(...all.map((e) => e.item.from))
  const spanTo = Math.min(...all.map((e) => itemEnd(e.item)))
  if (spanTo - spanFrom < 2 * fps) {
    fail(
      `The angles and mics overlap for only ${Math.max(0, spanTo - spanFrom)} frames (${all.map((e) => `${e.item.id} ${e.item.from}-${itemEnd(e.item)}`).join(', ')}). ` +
        'They must play the same stretch of the conversation — line them up with sync_angles first.'
    )
  }

  const options: Partial<SwitchOptions> = {
    thresholdDb: typeof args.thresholdDb === 'number' && Number.isFinite(args.thresholdDb) ? args.thresholdDb : null,
    dominanceDb: numberArg(args, 'dominanceDb', SWITCH_DEFAULTS.dominanceDb),
    minShotSec: numberArg(args, 'minShotSec', SWITCH_DEFAULTS.minShotSec),
    leadSec: numberArg(args, 'leadSec', SWITCH_DEFAULTS.leadSec)
  }

  const api = media()
  const curves: number[][] = []
  for (const { item } of mics) {
    const asset = audioAsset(item, 'measure as a mic')
    const windowUs = Math.round(LEVEL_WINDOW_SEC * 1_000_000 * speedOf(item))
    curves.push(await measured('Reading mic levels', asset, api.levels(asset.path, sourceSpan(item, fps, spanFrom, spanTo), windowUs)))
  }
  const plan = planSwitch(curves, { startFrame: spanFrom, endFrame: spanTo, fps }, wide !== null, options)
  const labels = videos.map((_, i) => `angle ${i + 1} (${nameOf(mics[i]!.item)})`)

  if (plan.anglesUsed < 2) {
    const quiet = plan.mics.map((m, i) => ({ m, i })).filter(({ m }) => m.activeShare === 0)
    const onlyAngle = plan.segments[0]?.angle
    fail(
      (plan.anglesUsed === 0
        ? 'No mic crossed its threshold anywhere, so nobody was ever "talking" and there is nothing to cut. '
        : `Only ${onlyAngle === videos.length ? 'the wide' : labels[onlyAngle!]} would ever be on screen, so the switch would change nothing and was not made. `) +
        (quiet.length > 0 ? `Never talking: ${quiet.map(({ i }) => labels[i]).join(', ')}. ` : '') +
        'Per mic — ' + plan.mics.map((m, i) => micLine(labels[i]!, m)).join('; ') + '. ' +
        'If one mic carries everyone (a single mixed track on every angle), speakers cannot be told apart by level: give each angle its own mic. ' +
        'If a mic is just quiet, pass thresholdDb a few dB above the quietest room level shown.'
    )
  }

  // Sound embedded in an angle would go silent with its picture: detach it first, in the same step.
  const embedded = pictures
    .filter(({ item }) => !item.audioDetached && findAsset(project(), item.assetId)?.hasAudio)
    .map(({ item }) => item.id)
  const angleIds = pictures.map((p) => p.item.id)
  const total = spanTo - spanFrom
  const screenTime = pictures.map((p, index) => {
    const frames = plan.segments.filter((s) => s.angle === index).reduce((sum, s) => sum + s.toFrame - s.fromFrame, 0)
    return {
      angle: index === videos.length ? 'wide' : index + 1,
      videoItemId: p.item.id,
      seconds: round(frames / fps, 1),
      share: round(frames / total)
    }
  })
  const starved = screenTime.filter((s) => s.share < 0.1 && s.angle !== 'wide')
  const planned = {
    span: { fromFrame: spanFrom, toFrame: spanTo },
    cuts: plan.segments.slice(1).map((s) => ({ frame: s.fromFrame, to: s.angle === videos.length ? 'wide' : s.angle + 1 })),
    shots: plan.segments.length,
    screenTime,
    mics: plan.mics.map((m, i) => ({ angle: i + 1, micItemId: mics[i]!.item.id, ...roundStats(m) }))
  }
  if (dryRun(args)) {
    return { validateOnly: true, ...planned, ...(embedded.length > 0 ? { wouldDetachSoundOf: embedded } : {}), note: DRY_NOTE }
  }

  let applied = { createdItemIds: [] as string[], disabledItemIds: [] as string[] }
  let detached: string[] = []
  store().transact(() => {
    if (embedded.length > 0) {
      const result = store().detachAudio(embedded)
      detached = result.detached.map((d) => d.audioId)
    }
    applied = store().applyAngleSwitch(angleIds, plan.segments)
  })
  return {
    ...planned,
    createdItemIds: applied.createdItemIds,
    disabledItemIds: applied.disabledItemIds,
    ...(detached.length > 0 ? { detachedSoundItemIds: detached } : {}),
    settings: { ...SWITCH_DEFAULTS, ...options },
    next:
      `${plan.segments.length} shots across ${plan.anglesUsed} angles. Check two or three cuts with preview_frame. ` +
      (starved.length > 0
        ? `Angle ${starved.map((s) => s.angle).join(', ')} is on screen under 10% of the time — check that mic, or that its speaker really spoke so little. `
        : '') +
      'To keep an angle on longer, set_item_enabled the pieces; to calm the cutting, undo and run again with a larger minShotSec.' +
      (detached.length > 0 ? ' The angles\' own sound was detached onto audio tracks so it keeps playing.' : '')
  }
}

function roundStats(m: MicStats): Record<string, number | null> {
  return {
    floorDb: round(m.floorDb, 1),
    speechDb: round(m.speechDb, 1),
    thresholdDb: Number.isFinite(m.thresholdDb) ? round(m.thresholdDb, 1) : null,
    activeShare: m.activeShare
  }
}

// ---------------------------------------------------------------------------
// level_voices
// ---------------------------------------------------------------------------

export async function levelVoices(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const named = resolveItemIds((args.itemIds as unknown[]) ?? [], 'itemIds')
  if (named.length === 0) fail('itemIds is empty. Name the clips that carry each speaker.')
  const tl = timeline()
  const fps = tl.fps
  const targetLufs = numberArg(args, 'targetLufs', DEFAULT_VOICE_LUFS)

  // A picture whose sound is detached plays no sound of its own: level its sound clip instead.
  const redirected: { from: string; to: string }[] = []
  const entries = named.map((entry) => {
    if (!entry.item.audioDetached) return entry
    const sound = linkedPartners(tl, entry.item.id).find((p) => tl.tracks.find((t) => t.id === p.trackId)?.kind === 'audio')
    if (!sound) return entry
    redirected.push({ from: entry.item.id, to: sound.id })
    const track = tl.tracks.find((t) => t.id === sound.trackId)!
    return { item: sound, track }
  })
  refuseLocked(entries, 'changing their gain')
  const keyed = entries.filter((e) => (e.item.keyframes?.volume?.length ?? 0) > 0)
  if (keyed.length > 0) {
    fail(
      `${keyed.map((e) => e.item.id).join(', ')} ${keyed.length === 1 ? 'has' : 'have'} volume keyframes, so ${keyed.length === 1 ? 'its' : 'their'} level is the keys', not a gain to set. ` +
        'Leave those out, or remove the volume keys with edit_item first.'
    )
  }

  const api = media()
  const rows: Record<string, unknown>[] = []
  const silent: string[] = []
  const patches: { id: string; volume: number }[] = []
  for (const { item, track } of entries) {
    const asset = audioAsset(item, 'measure')
    const loudness = await measured('Loudness measurement', asset, api.loudness(asset.path, sourceSpan(item, fps)))
    if (!(loudness.integratedLufs > SILENT_LUFS)) {
      silent.push(item.id)
      continue
    }
    const plan = planVoiceLevel(loudness.integratedLufs, item.volume, track.volume ?? 1, targetLufs)
    patches.push({ id: item.id, volume: plan.volume })
    rows.push({
      itemId: item.id,
      name: asset.name,
      measuredLufs: round(loudness.integratedLufs, 1),
      beforeLufs: plan.beforeLufs,
      afterLufs: plan.afterLufs,
      volumeBefore: item.volume,
      volumeAfter: plan.volume,
      ...(plan.neededGainDb !== undefined ? { shortOfTargetDb: round(targetLufs - plan.afterLufs, 1) } : {})
    })
  }
  if (patches.length === 0) {
    fail(`Every clip named is silent (${silent.join(', ')}): no speech to measure. Pass the clips that carry the voices.`)
  }
  if (dryRun(args)) {
    return { validateOnly: true, targetLufs, clips: rows, ...(silent.length > 0 ? { skippedSilent: silent } : {}), note: DRY_NOTE }
  }
  store().transact(() => {
    for (const patch of patches) store().patchItem(patch.id, { volume: patch.volume }, { linked: false })
  })
  const short = rows.filter((r) => r.shortOfTargetDb !== undefined)
  return {
    targetLufs,
    clips: rows,
    ...(silent.length > 0 ? { skippedSilent: silent } : {}),
    ...(redirected.length > 0 ? { leveledSoundOf: redirected } : {}),
    next:
      `${rows.length} clip${rows.length === 1 ? '' : 's'} set to about ${targetLufs} LUFS.` +
      (short.length > 0
        ? ` ${short.map((r) => r.itemId).join(', ')} needed more than the +6 dB clip gain allows; raise ${short.length === 1 ? 'its' : 'their'} track fader or choose a lower targetLufs.`
        : '') +
      (redirected.length > 0 ? ' Pictures with detached sound were levelled through their sound clips.' : '')
  }
}

// ---------------------------------------------------------------------------
// sync_angles
// ---------------------------------------------------------------------------

export async function syncAngles(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entries = resolveItemIds((args.itemIds as unknown[]) ?? [], 'itemIds')
  if (entries.length < 2) fail('sync_angles needs at least two clips of the same event, the reference first.')
  const tl = timeline()
  const fps = tl.fps
  // A clip and its own linked sound move together; naming both would move it twice.
  for (let i = 0; i < entries.length; i += 1) {
    const partners = linkedPartners(tl, entries[i]!.item.id).map((p) => p.id)
    const twin = entries.slice(i + 1).find((e) => partners.includes(e.item.id))
    if (twin) fail(`${twin.item.id} is linked to ${entries[i]!.item.id} and moves with it. Pass only one of the two.`)
  }
  refuseLocked(entries, 'moving them into sync')

  const api = media()
  const curves: number[][] = []
  for (const { item } of entries) {
    const asset = audioAsset(item, 'sync by')
    const windowUs = Math.round(SYNC_WINDOW_SEC * 1_000_000 * speedOf(item))
    curves.push(await measured('Reading the sound envelope', asset, api.levels(asset.path, sourceSpan(item, fps), windowUs)))
  }
  const reference = entries[0]!
  const rows: { itemId: string; offsetSec: number; correlation: number; peakRatio: number; overlapSec: number; target: number }[] = []
  const doubtful: string[] = []
  for (let i = 1; i < entries.length; i += 1) {
    const offset = findSyncOffset(curves[0]!, curves[i]!)
    const item = entries[i]!.item
    if (!offset) {
      doubtful.push(`${item.id} ("${nameOf(item)}") shares too little sound with the reference at any offset`)
      continue
    }
    if (!offset.confident) {
      doubtful.push(
        `${item.id} ("${nameOf(item)}"): correlation ${offset.correlation} (needs ${MIN_SYNC_CORRELATION}), peak ratio ${offset.peakRatio} (needs ${MIN_SYNC_PEAK_RATIO})`
      )
    }
    rows.push({
      itemId: item.id,
      offsetSec: offset.offsetSec,
      correlation: offset.correlation,
      peakRatio: offset.peakRatio,
      overlapSec: offset.overlapSec,
      target: reference.item.from + Math.round(offset.offsetSec * fps)
    })
  }
  if (doubtful.length > 0) {
    fail(
      `Nothing was moved: the sound does not identify one offset for ${doubtful.join('; ')}. ` +
        'Low correlation means the clips may not share sound (a camera with its mic off, a different take); a low peak ratio means ' +
        'the sound repeats (a music bed, a metronome) so several offsets fit. Sync that clip by hand with edit_item, or leave it out and run again.'
    )
  }

  // Everything lands where the offsets say; if that is before frame 0, everything shifts right.
  const targets = new Map<string, number>([[reference.item.id, reference.item.from], ...rows.map((r) => [r.itemId, r.target] as [string, number])])
  const shift = Math.max(0, -Math.min(...targets.values()))
  for (const [id, from] of targets) targets.set(id, from + shift)

  // Moves are checked before anything moves, own track and linked partners alike, so a refused
  // move cannot leave half the clips synced.
  const moving = new Set<string>(withLinked(tl, [...targets.keys()]))
  const plannedMoves = entries
    .map(({ item }) => ({ item, delta: targets.get(item.id)! - item.from }))
    .filter((m) => m.delta !== 0)
  for (const { item, delta } of plannedMoves) {
    for (const piece of [item, ...linkedPartners(tl, item.id)]) {
      const track = tl.tracks.find((t) => t.id === piece.trackId)!
      if (track.locked) fail(`${piece.id} is on locked track ${track.name} and would have to move ${delta} frames. Unlock it first.`)
      const from = piece.from + delta
      const end = from + piece.durationInFrames
      const clash = track.items.find((other) => !moving.has(other.id) && other.from < end && from < itemEnd(other))
      if (clash) {
        fail(
          `Syncing would move ${piece.id} to frames ${from}-${end} on ${track.name}, where ${clash.id} (${clash.from}-${itemEnd(clash)}) is. ` +
            'Move that clip or put this one on its own track, then run again.'
        )
      }
    }
  }
  if (dryRun(args)) {
    return {
      validateOnly: true,
      reference: { itemId: reference.item.id, from: targets.get(reference.item.id) },
      clips: rows.map((r) => ({ itemId: r.itemId, offsetSec: r.offsetSec, from: targets.get(r.itemId), correlation: r.correlation, peakRatio: r.peakRatio })),
      ...(shift > 0 ? { shiftedRightFrames: shift } : {}),
      note: DRY_NOTE
    }
  }
  store().transact(() => {
    // Leftward moves first, earliest first; then rightward, latest first — so two clips on one
    // track never pass through each other on the way.
    const left = plannedMoves.filter((m) => m.delta < 0).sort((a, b) => a.item.from - b.item.from)
    const right = plannedMoves.filter((m) => m.delta > 0).sort((a, b) => b.item.from - a.item.from)
    const ordered = [...left, ...right]
    for (const { item } of ordered) store().moveItem(item.id, targets.get(item.id)!)
  })
  const after = allItems(timeline())
  const missed = plannedMoves.filter(({ item }) => after.find((i) => i.id === item.id)?.from !== targets.get(item.id))
  if (missed.length > 0) {
    throw new ToolError(`${missed.map((m) => m.item.id).join(', ')} could not be moved into sync. Undo, check the tracks for clips in the way, and run again.`)
  }
  return {
    reference: { itemId: reference.item.id, from: targets.get(reference.item.id) },
    clips: rows.map((r) => ({
      itemId: r.itemId,
      offsetSec: r.offsetSec,
      offsetFrames: Math.round(r.offsetSec * fps),
      from: targets.get(r.itemId),
      movedFrames: targets.get(r.itemId)! - entries.find((e) => e.item.id === r.itemId)!.item.from,
      correlation: r.correlation,
      peakRatio: r.peakRatio,
      overlapSec: r.overlapSec
    })),
    ...(shift > 0 ? { shiftedRightFrames: shift } : {}),
    next:
      plannedMoves.length === 0
        ? 'Every clip was already in sync; nothing moved.'
        : `${plannedMoves.length} clip${plannedMoves.length === 1 ? '' : 's'} moved into sync (linked sound moved with ${plannedMoves.length === 1 ? 'it' : 'them'}). ` +
          'Play a moment with a clear hard sound — a clap, a laugh — to confirm, then switch_speakers.'
  }
}

export const handlers: Handlers = {
  set_item_enabled: (args) => setItemEnabled(args),
  remove_silences: (args) => removeSilences(args),
  switch_speakers: (args) => switchSpeakers(args),
  level_voices: (args) => levelVoices(args),
  sync_angles: (args) => syncAngles(args)
}
