/**
 * `put_behind_subject` — a title behind the person in a clip.
 *
 * Three steps, in an order that keeps the project honest: the matte is computed (or found) in main
 * first, for exactly the source range the clip plays (`matteSpanForItem`); only a matte that found a
 * person in most frames is recorded on the asset (silently, like a beat grid — derived data); then
 * the arrangement is one store edit (`putBehindSubject`, one undo step). A refusal at any step has
 * changed nothing the undo stack would show.
 */

import { findAsset, itemEnd, type Asset } from '@shared/project'
import { matteSpanForItem, MAX_MASK_FEATHER, type SubjectMatte, type SubjectMatteReport } from '@shared/matte'
import { bay } from '@/lib/bay'
import { fail, project, resolveItem, store, timeline, ToolError, type Handlers } from './helpers'

/**
 * Under this share of frames with a person, the clip is not a talking head or a person-led shot,
 * and a cut-out would flicker in and out over the title. Measured: a two-person 1080p clip 1.00,
 * a colour-bar test pattern 0.00.
 */
export const MIN_SUBJECT_COVERAGE = 0.5

const pct = (n: number): string => `${Math.round(n * 100)}%`

/**
 * The matte for the clip's span, from main: found in its cache (a hash of 3 MiB and one small read)
 * or computed now. Always asked, even when the asset already records one — a record whose pack
 * was cleared from the cache would otherwise report success over a placeholder.
 */
async function matteFor(asset: Asset, fromUs: number, toUs: number): Promise<{ matte: SubjectMatte; report: SubjectMatteReport }> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot find the person in the clip.')
  if (!asset.path) fail(`"${asset.name}" has no media file to find a person in.`)
  const result = await api.media.subjectMatte({ path: asset.path, fromUs, toUs })
  if (!result.ok) {
    if (result.code === 'unavailable') {
      throw new ToolError(
        `Apple Vision is not available here, so bay cannot cut the person out: ${result.error} ` +
          'The title can still go over the clip as it is; a cut-out needs a Mac with macOS 12 or later.'
      )
    }
    if (result.code === 'no-picture') throw new ToolError(`${result.error} Pick the clip that shows the person (videoItemId).`)
    throw new ToolError(`${result.error} Nothing was changed; ask again, or pick another clip.`)
  }
  return { matte: result.matte, report: result.report }
}

export async function putBehindSubject(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const overlayId = typeof args.textItemId === 'string' ? args.textItemId : typeof args.itemId === 'string' ? args.itemId : null
  if (!overlayId) fail('put_behind_subject needs the title: textItemId (a text item) or itemId (any graphic). read_project lists them.')
  if (typeof args.textItemId === 'string' && typeof args.itemId === 'string' && args.textItemId !== args.itemId) {
    fail('Pass the title once: textItemId or itemId, not both.')
  }
  if (typeof args.videoItemId !== 'string') fail('put_behind_subject needs videoItemId: the clip with the person in it.')
  const feather = args.feather === undefined ? 0 : Number(args.feather)
  if (!Number.isFinite(feather) || feather < 0 || feather > MAX_MASK_FEATHER) {
    fail(`feather must be a number of pixels from 0 to ${MAX_MASK_FEATHER}; got ${JSON.stringify(args.feather)}.`)
  }

  const overlay = resolveItem(overlayId)
  const video = resolveItem(args.videoItemId)
  const asset = findAsset(project(), video.item.assetId)
  const overlayAsset = findAsset(project(), overlay.item.assetId)
  if (!asset) fail(`The clip ${video.item.id} has no asset in the project.`)
  if (asset.kind !== 'video' || !asset.hasVideo) {
    const videos = timeline()
      .tracks.filter((t) => t.kind === 'video')
      .flatMap((t) => t.items)
      .filter((i) => {
        const a = findAsset(project(), i.assetId)
        return a?.kind === 'video' && a.hasVideo && i.from < itemEnd(overlay.item) && overlay.item.from < itemEnd(i)
      })
      .map((i) => i.id)
    fail(
      `${video.item.id} is a ${asset.kind} ("${asset.name}"), not a video clip — only a video has a person to cut out. ` +
        (videos.length > 0 ? `Video clips playing under the title: ${videos.join(', ')}.` : 'No video clip plays while the title does.')
    )
  }
  if (overlay.item.id === video.item.id) fail('The title and the clip are the same item. Pass the title as textItemId (or itemId) and the clip as videoItemId.')
  if (typeof args.textItemId === 'string' && overlayAsset?.kind !== 'text') {
    fail(`${overlay.item.id} is not a text item (it is ${overlayAsset?.kind ?? 'unknown'}); pass it as itemId instead.`)
  }
  if (!(overlay.item.from < itemEnd(video.item) && video.item.from < itemEnd(overlay.item))) {
    fail(
      `The title (${overlay.item.id}, frames ${overlay.item.from}–${itemEnd(overlay.item)}) and the clip (${video.item.id}, frames ` +
        `${video.item.from}–${itemEnd(video.item)}) never play at the same time. Move the title over the clip (edit_item from), then ask again.`
    )
  }

  const { fromUs, toUs } = matteSpanForItem(video.item, asset, timeline().fps)
  const { matte, report } = await matteFor(asset, fromUs, toUs)
  if (report.coverage < MIN_SUBJECT_COVERAGE) {
    fail(
      `This is not a person-shaped clip: Apple Vision found a person in ${pct(report.coverage)} of its ${report.frames} frames ` +
        `(it needs ${pct(MIN_SUBJECT_COVERAGE)}). Pick a clip where someone is in frame for most of the title, or leave the title over the clip as it is. ` +
        'Nothing was changed.'
    )
  }

  // Recorded silently: a matte is derived from the file, like a poster or a beat grid.
  const fresh = findAsset(project(), asset.id)
  if (fresh && !fresh.subjectMattes?.some((m) => m.key === matte.key)) {
    store().patchAsset(asset.id, { subjectMattes: [...(fresh.subjectMattes ?? []).filter((m) => m.engine !== matte.engine || m.fromUs < matte.fromUs || m.toUs > matte.toUs), matte] })
  }

  let result: ReturnType<ReturnType<typeof store>['putBehindSubject']> | null = null
  store().transact(() => {
    result = store().putBehindSubject({ videoItemId: video.item.id, overlayItemId: overlay.item.id, ...(feather > 0 ? { feather } : {}) })
  })
  const done = result as ReturnType<ReturnType<typeof store>['putBehindSubject']> | null
  if (!done) fail('No timeline is open.')
  if (!done.ok) fail(done.error)

  const tl = timeline()
  const name = (trackId: string): string => tl.tracks.find((t) => t.id === trackId)?.name ?? trackId
  const placed = done.reused
    ? `The cut-out ${done.cutoutItemId} on ${name(done.cutoutTrackId)} was already there; its edge was updated.`
    : `${name(done.videoTrackId)}: the clip ${video.item.id} (unchanged). ${name(done.overlayTrackId)}: the title ${overlay.item.id}` +
      `${done.movedOverlay ? ' (moved up from under the clip)' : ''}. ${name(done.cutoutTrackId)}: ${done.cutoutItemId}, a copy of the clip ` +
      'cut out to the person — linked to the clip, silent, drawn from the same decoded frame.'
  return {
    cutoutItemId: done.cutoutItemId,
    cutoutTrackId: done.cutoutTrackId,
    overlayTrackId: done.overlayTrackId,
    videoTrackId: done.videoTrackId,
    ...(done.createdTrackIds.length > 0 ? { createdTracks: done.createdTrackIds.map((id) => ({ trackId: id, name: name(id) })) } : {}),
    movedOverlay: done.movedOverlay,
    placed,
    matte: {
      frames: matte.frames,
      sourceRange: { fromSeconds: Math.round(matte.fromUs / 1000) / 1000, toSeconds: Math.round(matte.toUs / 1000) / 1000 },
      cached: report.cached,
      personInFrames: pct(report.coverage),
      msPerFrame: report.msPerFrame,
      visionMsPerFrame: report.visionMsMedian,
      megabytesPerMinute: report.megabytesPerMinute
    },
    ...(done.warnings.length > 0 ? { warnings: done.warnings } : {}),
    next:
      'Check it: preview_frame at a frame where the person\'s head crosses the title. The title should show beside the person and be ' +
      'hidden behind them. If the edge is hard on hair, call again with feather 3. Keep the title between the two copies — ' +
      'anything placed on the cut-out\'s track or above it draws in front of the person.'
  }
}

export const handlers: Handlers = {
  put_behind_subject: (args) => putBehindSubject(args)
}
