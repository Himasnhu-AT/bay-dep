/**
 * `generate_image`, `generate_video` and `track_generation`.
 *
 * Like an export, a generation outlives its call — but unlike an export the work is in main (and
 * on a provider's servers), so this module keeps no state: the job table lives in main, persisted
 * and resumed across restarts, and `track_generation` reads it fresh every time.
 *
 * The generate tools are `selfValidating`: `validateOnly: true` reaches the handler, which checks
 * the call against the catalog (`@shared/generation`), prices it and says whether a key is set —
 * and starts nothing. A store dry run could not promise that, because the effect it would have to
 * undo is a paid request.
 *
 * When a job lands, the file is imported through the ordinary import path (`importMedia`), so
 * it is an asset like any other, admitted to `bay://` by main, and deduplicated by path — polling
 * a finished job again returns the same asset.
 */

import {
  PROVIDERS,
  validateGeneration,
  type GenerationJob,
  type GenerationKind
} from '@shared/generation'
import { VALIDATE_ONLY } from '@shared/mcp'
import { bay } from '@/lib/bay'
import { fail, resolveAsset, type Handlers } from './helpers'
import { importMedia, placeAsset } from './write'

function api(): NonNullable<ReturnType<typeof bay>> {
  const bridge = bay()
  if (!bridge) fail('This window has no bridge to the app, so nothing can be generated.')
  return bridge
}

async function generate(kind: GenerationKind, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dry = args[VALIDATE_ONLY] === true
  const { [VALIDATE_ONLY]: _flag, referenceAssetId, ...rest } = args

  let referencePath: string | undefined
  if (referenceAssetId !== undefined) {
    const asset = resolveAsset(String(referenceAssetId))
    if (asset.kind !== 'image') {
      fail(
        `${asset.name} is ${asset.kind === 'video' ? 'a video' : `a ${asset.kind}`}; referenceAssetId takes an image asset ` +
          `(PNG, JPEG or WebP). Import a still, or use a freeze frame of the clip.`
      )
    }
    if (asset.error) fail(`${asset.name} could not be read (${asset.error}), so it cannot be sent as a reference.`)
    if (!asset.path) fail(`${asset.name} has no file on this Mac, so it cannot be sent as a reference. Relink it first.`)
    referencePath = asset.path
  }

  const checked = validateGeneration({ ...rest, ...(referencePath ? { referencePath } : {}) }, kind)
  if (!checked.ok) fail(checked.errors.join(' '))
  const { request, estimatedCostUsd, defaultsApplied } = checked
  const label = PROVIDERS[request.provider].label

  const keys = await api().generation.keys()
  const keySet = keys.some((k) => k.provider === request.provider && k.set)
  const noKey =
    `No ${label} key is set, so this cannot run. Tell the user to add one in Settings › Providers ` +
    `(bay never takes keys in chat), then call this again.`

  if (dry) {
    return {
      valid: true,
      model: request.model,
      provider: request.provider,
      request: { ...request, ...(referencePath ? { referencePath: undefined, referenceAssetId } : {}) },
      estimatedCostUsd,
      costNote: 'An estimate from list prices, not a bill; the provider’s dashboard is the authority.',
      defaultsApplied,
      keySet,
      ...(keySet ? {} : { blocked: noKey })
    }
  }

  if (!keySet) fail(noKey)
  const started = await api().generation.start(request)
  if (!started.ok) fail(started.error)
  return {
    ...summarise(started.job),
    defaultsApplied,
    next:
      `Call track_generation { jobId: "${started.job.id}" }` +
      (kind === 'video' ? ' every 15–30 seconds' : '') +
      ' until it is done or failed, before your final answer.'
  }
}

function summarise(job: GenerationJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    kind: job.kind,
    model: job.model,
    provider: job.provider,
    ...(job.progress !== undefined ? { progress: job.progress } : {}),
    ...(job.estimatedCostUsd !== undefined ? { estimatedCostUsd: job.estimatedCostUsd } : {}),
    ...(job.error ? { error: job.error } : {}),
    findings: job.findings ?? [],
    elapsedSeconds: Math.round((Date.now() - job.createdAt) / 1000)
  }
}

async function track(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bridge = api()
  if (args.jobId === undefined) {
    const jobs = await bridge.generation.jobs()
    return { jobs: jobs.slice(0, 20).map(summarise) }
  }
  const id = String(args.jobId)
  const job = await bridge.generation.job(id)
  if (!job) {
    const recent = (await bridge.generation.jobs()).slice(0, 10).map((j) => `${j.id} (${j.kind}, ${j.status})`)
    fail(
      `There is no generation job "${id}". ` +
        (recent.length > 0 ? `Recent jobs: ${recent.join(', ')}.` : 'No jobs have been started — call generate_image or generate_video first.')
    )
  }

  if (job.status === 'queued' || job.status === 'running') {
    return { ...summarise(job), next: 'Still working. Call track_generation again in 15–30 seconds.' }
  }
  if (job.status === 'failed') {
    return {
      ...summarise(job),
      next: 'Nothing was imported. Tell the user what failed; retry only if the error says a retry can help.'
    }
  }
  if (!job.outputPath) fail(`Job ${job.id} is done but main recorded no file for it. This is a fault in bay; generate again.`)

  const imported = await importMedia({ paths: [job.outputPath] })
  const asset = (imported.assets as Record<string, unknown>[])[0]
  if (!asset || asset.error) {
    return {
      ...summarise(job),
      status: 'failed',
      error: `The file landed at ${job.outputPath} but could not be imported${asset?.error ? `: ${String(asset.error)}` : ''}.`
    }
  }
  const result: Record<string, unknown> = { ...summarise(job), asset }
  if (args.place === true) {
    result.placed = placeAsset({
      assetId: asset.id,
      ...(args.atFrame !== undefined ? { atFrame: args.atFrame } : {}),
      ...(args.trackId !== undefined ? { trackId: args.trackId } : {})
    })
  } else {
    result.next = `The asset is in the media pool. Place it with place_asset { assetId: "${String(asset.id)}" } where the edit needs it.`
  }
  return result
}

export const handlers: Handlers = {
  generate_image: (args) => generate('image', args),
  generate_video: (args) => generate('video', args),
  track_generation: (args) => track(args)
}
