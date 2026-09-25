/**
 * `index_footage` and `search_footage` — visual search over the project's own files.
 *
 * The model, the index and the ranking are main's (`main/vision/`); this adapter decides which
 * files (the project's videos and images with a file on disk), passes the user's "Download
 * models when needed" along, and maps each hit onto the timeline through the clips that play it —
 * `timelineFrameAt`, the same mapping as beats, so a hit's frame is where that picture is.
 *
 * `index_footage` is `selfValidating`: the job runs in main, outside anything a store restore can
 * undo, so `validateOnly` reaches this handler and asks main for the plan alone.
 */

import { VALIDATE_ONLY } from '@shared/mcp'
import { allItems, US_PER_SECOND, type Asset, type Timeline } from '@shared/project'
import { timelineFrameAt } from '@shared/beats'
import { describeDuration, describeJob, type VisionAssetRef, type VisionHit, type VisionIndexPlan } from '@shared/visual-search'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'
import { fail, project, resolveAsset, timeline, type Handlers } from './helpers'

const seconds = (us: number): number => Math.round(us / 1000) / 1000

/** A file visual search can read: a video with a picture, or an image, with a path. */
function searchable(asset: Asset): asset is Asset & { path: string; kind: 'video' | 'image' } {
  return !!asset.path && ((asset.kind === 'video' && asset.hasVideo !== false) || asset.kind === 'image')
}

const refOf = (asset: Asset & { path: string; kind: 'video' | 'image' }): VisionAssetRef => ({
  assetId: asset.id,
  name: asset.name,
  path: asset.path,
  kind: asset.kind,
  durationUs: asset.kind === 'image' ? 0 : asset.durationUs
})

/**
 * The files to index or search: the listed assets, each checked, or every searchable one in the
 * project. A listed asset that cannot be searched is refused by name with what it is.
 */
export function footageRefs(assets: readonly Asset[], assetIds: unknown, resolve: (id: string) => Asset): VisionAssetRef[] {
  if (assetIds !== undefined && !Array.isArray(assetIds)) fail('assetIds must be a list of asset ids, from browse_assets.')
  if (Array.isArray(assetIds) && assetIds.length > 0) {
    return assetIds.map((id) => {
      const asset = resolve(String(id))
      if (!searchable(asset)) {
        fail(`"${asset.name}" is ${asset.kind === 'audio' ? 'audio' : `a ${asset.kind} asset`}, with no picture file to search. Only videos and images can be indexed.`)
      }
      return refOf(asset)
    })
  }
  const all = assets.filter(searchable).map(refOf)
  if (all.length === 0) fail('This project has no video or image files to search. Import some with import_media first.')
  return all
}

/** Where a hit is on the timeline: every clip of its asset that plays that moment. */
export function hitPlacements(hit: VisionHit, tl: Timeline): { itemId: string; frame: number }[] {
  const out: { itemId: string; frame: number }[] = []
  for (const item of allItems(tl)) {
    if (item.assetId !== hit.assetId) continue
    const frame = timelineFrameAt(item, hit.us, tl.fps)
    if (frame !== null) out.push({ itemId: item.id, frame })
  }
  return out
}

function describePlan(plan: VisionIndexPlan): string {
  if (plan.toIndex === 0) return `All ${plan.indexed} file${plan.indexed === 1 ? ' is' : 's are'} already indexed.`
  return `${plan.toIndex} file${plan.toIndex === 1 ? '' : 's'} to index (${plan.frames} frames, ${describeDuration(plan.estimatedSeconds)} on this Mac)${plan.indexed > 0 ? `; ${plan.indexed} already indexed` : ''}.`
}

export async function indexFootage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot index footage.')

  if (args['cancel'] === true) {
    await api.vision.cancelIndex()
    const status = await api.vision.status()
    return { cancelled: true, ...(status.index ? { job: describeJob(status.index) } : {}) }
  }

  const status = await api.vision.status()
  // No files named while a job runs: this is a progress check, not a request to index everything.
  if (args['assetIds'] === undefined && status.index?.state === 'running' && args[VALIDATE_ONLY] !== true) {
    return { running: true, progress: describeJob(status.index), next: 'Call again to check; search_footage already works on the files that are done.' }
  }

  const refs = footageRefs(project().assets, args['assetIds'], resolveAsset)
  const dryRun = args[VALIDATE_ONLY] === true
  const answer = await api.vision.index(refs, { dryRun, download: useEditor.getState().autoDownloadModels })
  if (!answer.ok) fail(answer.error)
  const plan = answer.plan
  const unavailable = plan.unavailable.map((u) => `${u.name}: ${u.error}`)
  if (dryRun) {
    return {
      valid: true,
      modelInstalled: status.installed,
      files: plan.files,
      alreadyIndexed: plan.indexed,
      toIndex: plan.toIndex,
      frames: plan.frames,
      estimatedSeconds: plan.estimatedSeconds,
      plan: describePlan(plan),
      ...(unavailable.length > 0 ? { unavailable } : {}),
      note: status.installed
        ? 'Nothing was started. Call again without validateOnly to index.'
        : 'Nothing was started, and the visual search model is not downloaded yet: the user gets it in Settings (⌘,) → Visual search.'
    }
  }
  return {
    started: answer.started,
    plan: describePlan(plan),
    ...(answer.job ? { progress: describeJob(answer.job) } : {}),
    ...(unavailable.length > 0 ? { unavailable } : {}),
    next: answer.started
      ? 'Indexing runs in the background. Call index_footage again (no arguments) to see progress; search_footage searches whatever is done.'
      : 'Nothing new to index — search_footage is ready.'
  }
}

export async function searchFootage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot search footage.')
  const query = typeof args['query'] === 'string' ? args['query'].trim() : ''
  const like = args['similarTo'] && typeof args['similarTo'] === 'object' ? (args['similarTo'] as Record<string, unknown>) : null
  if (!query && !like) fail('search_footage needs query (a description of the shot) or similarTo (an assetId and seconds).')
  if (query && like) fail('Pass query or similarTo, not both.')

  const refs = footageRefs(project().assets, args['assetIds'], resolveAsset)
  let similarTo: { assetId: string; us: number } | undefined
  if (like) {
    const asset = resolveAsset(String(like['assetId'] ?? ''))
    const at = typeof like['seconds'] === 'number' && Number.isFinite(like['seconds']) ? Math.max(0, like['seconds']) : 0
    similarTo = { assetId: asset.id, us: Math.round(at * US_PER_SECOND) }
    // The reference must be searched to be found, whatever assetIds narrowed the search to.
    if (!refs.some((r) => r.assetId === asset.id)) refs.push(...footageRefs(project().assets, [asset.id], resolveAsset))
  }
  const limit = typeof args['limit'] === 'number' && Number.isFinite(args['limit']) ? Math.max(1, Math.min(50, Math.round(args['limit']))) : 8

  const answer = await api.vision.search({ assets: refs, ...(query ? { query } : {}), ...(similarTo ? { similarTo } : {}), limit })
  if (!answer.ok) fail(answer.error)

  const names = new Map(refs.map((r) => [r.assetId, r.name]))
  const tl = timeline()
  const hits = answer.hits.map((hit, rank) => {
    const placements = hitPlacements(hit, tl)
    return {
      rank: rank + 1,
      assetId: hit.assetId,
      asset: names.get(hit.assetId) ?? hit.assetId,
      seconds: seconds(hit.us),
      us: hit.us,
      score: hit.score,
      ...(placements.length > 0 ? { onTimeline: placements } : {})
    }
  })
  const unindexed = answer.unindexed.map((id) => names.get(id) ?? id)
  return {
    hits,
    separation: answer.separation,
    framesSearched: answer.framesSearched,
    ...(answer.reference ? { comparedWith: { assetId: answer.reference.assetId, seconds: seconds(answer.reference.us) } } : {}),
    ...(unindexed.length > 0 ? { notIndexed: unindexed } : {}),
    next:
      answer.framesSearched === 0
        ? 'Nothing is indexed yet. Call index_footage, then search again.'
        : `${answer.separation < 0.02 ? 'The best hit barely stands out (separation near 0): nothing may really match — try a more concrete description. ' : ''}` +
          'Look at a hit with frame_grid or preview_frame before using it; place one with place_asset (a time in the file is `seconds`).' +
          (unindexed.length > 0 ? ` ${unindexed.length} file${unindexed.length === 1 ? ' was' : 's were'} not searched because not indexed yet — index_footage indexes them.` : '')
  }
}

export const handlers: Handlers = {
  index_footage: (args) => indexFootage(args),
  search_footage: (args) => searchFootage(args)
}
