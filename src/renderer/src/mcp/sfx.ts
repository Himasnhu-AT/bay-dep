/**
 * `score_sfx` — a film's sound effects, synthesised from a score (`@shared/sfx`).
 *
 * The score is checked here, so a bad one is refused without a round trip and a dry run needs
 * no bridge; main checks it again, renders it, writes the WAV where bay keeps what it generates
 * and measures it (`main/sfx/write.ts`). The file then comes in through the ordinary import
 * path — probed, deduplicated by path, admitted to `bay://` by main — exactly as a freeze frame
 * or a clip's subtitles do.
 *
 * `selfValidating`: a store dry run cannot take back a file written, so `validateOnly` reaches
 * this handler, which checks the score, renders it in memory for its peak and warnings, and
 * writes nothing.
 *
 * Creating the asset and placing it is one thing the agent asked for, so it is one undo step
 * and all or nothing — rehearsed first, the way `write_brf` does it, so a refused placement
 * does not leave an asset nobody placed.
 */

import { VALIDATE_ONLY } from '@shared/mcp'
import { findAsset, type Asset } from '@shared/project'
import { renderScore, renderWarnings } from '@shared/sfx/render'
import { checkScore, scoreDensity } from '@shared/sfx/score'
import { bay } from '@/lib/bay'
import { dryRun } from '@/store/dry-run'
import { fail, project, resolveTrack, store, type Handlers } from './helpers'
import { placeAsset } from './write'

const SCORE_ARGS = ['durationSeconds', 'events', 'room', 'seed', 'ceilingDb', 'tail'] as const

export async function scoreSfx(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = Object.fromEntries(SCORE_ARGS.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]))
  const checked = checkScore(input)
  if (!checked.ok) fail(`The score was not rendered. ${checked.errors.join(' ')}`)
  const score = checked.score

  const place = args.atFrame !== undefined
  if (args.trackId !== undefined) {
    if (!place) fail('trackId says where to place the sound, which needs atFrame too. Add atFrame, or drop trackId to only create the asset.')
    // Before anything is rendered: the placement itself is checked again when it happens.
    const track = resolveTrack(String(args.trackId))
    if (track.kind !== 'audio') {
      fail(`Sound effects go on an audio track, but ${track.name} is a ${track.kind} track. Omit trackId to let bay pick one.`)
    }
  }

  if (args[VALIDATE_ONLY] === true) {
    // Rendered here, in memory, and thrown away: the peak, the limiter and the tail are what a
    // dry run is for, and none of them can be known without making the sound. Only the
    // loudness is missing — that is ffmpeg's reading of a file, and no file is written.
    const rendered = renderScore(score)
    const density = scoreDensity(score.events.map((event) => event.t), score.durationSeconds)
    return {
      valid: true,
      events: rendered.events,
      eventsPerSecond: Number(density.perSecond.toFixed(2)),
      busiestSecond: { events: density.windowCount, fromSeconds: Number(density.windowFrom.toFixed(2)) },
      durationSeconds: Number(rendered.seconds.toFixed(4)),
      peakDb: Number.isFinite(rendered.peakDb) ? Number(rendered.peakDb.toFixed(2)) : null,
      warnings: [...checked.warnings, ...renderWarnings(score, rendered)],
      note: 'Nothing was written or changed. Call again without validateOnly to make the sound and measure its loudness.'
    }
  }

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so the sound cannot be written.')
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Sound effects'
  const written = await api.media.scoreSfx(name, input)
  if (!written.ok) fail(`The score was not rendered. ${written.error}`)
  const [imported] = await api.media.importPaths([written.path])
  if (!imported?.asset || imported.asset.error) {
    fail(`The sound was written to ${written.path} but could not be imported: ${imported?.asset.error ?? 'nothing came back'}.`)
  }
  if (!imported.asset.hasAudio) {
    fail(`The sound was written to ${written.path} but reads back with no audio in it, so it was not added. This is a fault in bay.`)
  }

  // The same score is the same file, and so the asset this project may already hold.
  const existing = findAsset(project(), imported.asset.id)
  const asset: Asset = existing ?? { ...imported.asset, name }
  const measured = {
    assetId: asset.id,
    name: asset.name,
    events: written.events,
    durationSeconds: written.seconds,
    peakDb: written.peakDb,
    truePeakDb: written.truePeakDb,
    integratedLufs: written.integratedLufs,
    ...(written.loudnessNote ? { loudnessNote: written.loudnessNote } : {}),
    ...(written.warnings.length > 0 ? { warnings: written.warnings } : {})
  }

  if (!place) {
    // The store adds an asset once by id, so a score already in the pool changes nothing here.
    store().addAssets([asset])
    return { ...measured, placed: false, next: 'place_asset with this assetId at the frame the film starts, or call again with atFrame.' }
  }

  const both = (): Record<string, unknown> => {
    store().addAssets([asset])
    return placeAsset({
      assetId: asset.id,
      atFrame: args.atFrame,
      ...(args.trackId !== undefined ? { trackId: args.trackId } : {})
    })
  }
  dryRun(both)
  let placed: Record<string, unknown> = {}
  store().transact(() => {
    placed = both()
  })
  return {
    ...measured,
    placed: true,
    ...placed,
    next: 'Play it against the picture; lower the clip with edit_item volume if music or a voice needs the room.'
  }
}

export const handlers: Handlers = {
  score_sfx: (args) => scoreSfx(args)
}
