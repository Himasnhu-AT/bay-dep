/**
 * `generate_image`, `generate_video`, `generate_speech`, `estimate_speech` and `track_generation`.
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
 * When a job lands, the file is imported through the ordinary import path (`media.importPaths`,
 * as `import_media` does), so it is an asset like any other, admitted to `bay://` by main, and
 * deduplicated by path — polling a finished job again returns the same asset. Adding it and
 * placing it are one `transact`: one undo step.
 */

import {
  PROVIDERS,
  validateGeneration,
  type GenerationJob,
  type GenerationKind
} from '@shared/generation'
import { VALIDATE_ONLY } from '@shared/mcp'
import { activeTimeline } from '@shared/project'
import { validateSpeech } from '@shared/speech'
import { estimateSpeech, type SpeechEstimate, type SpeechPace } from '@shared/speech-duration'
import { bay } from '@/lib/bay'
import { ToolError, fail, resolveAsset, store, usToFramesAtTimeline, type Handlers } from './helpers'
import { placeAsset } from './write'

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

/** Frames at the active timeline's fps, or null when there is no timeline yet. */
function framesOf(seconds: number): number | null {
  const fps = activeTimeline(store().project)?.fps
  return fps ? Math.round(seconds * fps) : null
}

/** The estimate as an agent reads it: seconds, frames, range and how it was counted. */
function spoken(estimate: SpeechEstimate): Record<string, unknown> {
  return {
    seconds: estimate.seconds,
    frames: framesOf(estimate.seconds),
    range: estimate.range,
    language: estimate.language,
    languageDetected: estimate.detected,
    pace: estimate.pace,
    ...(estimate.speed !== 1 ? { speed: estimate.speed } : {}),
    [estimate.unit]: estimate.units,
    breakdown: estimate.breakdown,
    notes: estimate.notes
  }
}

async function speak(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dry = args[VALIDATE_ONLY] === true
  const { [VALIDATE_ONLY]: _flag, ...rest } = args
  const checked = validateSpeech(rest)
  if (!checked.ok) fail(checked.errors.join(' '))
  const { request, estimatedCostUsd, defaultsApplied, estimate } = checked
  const label = PROVIDERS[request.provider].label

  const keys = await api().generation.keys()
  const keySet = keys.some((k) => k.provider === request.provider && k.set)
  const noKey =
    `No ${label} key is set, so this cannot run. Tell the user to add one in Settings › Providers ` +
    `(bay never takes keys in chat), then call this again.`
  const estimated = { ...spoken(estimate), note: 'An estimate; the generated file’s measured length is the authority.' }

  if (dry) {
    const { prompt: _text, ...options } = request
    return {
      valid: true,
      model: request.model,
      provider: request.provider,
      request: { ...options, characters: request.prompt.length },
      estimatedCostUsd,
      costNote: 'An estimate from list prices, not a bill; the provider’s dashboard is the authority.',
      estimatedSpeech: estimated,
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
    estimatedSpeech: estimated,
    defaultsApplied,
    next: `Call track_generation { jobId: "${started.job.id}" } until it is done or failed, before your final answer.`
  }
}

function estimate(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.text !== 'string' || !args.text.trim()) fail('text is empty. Pass the words to be spoken.')
  // `pace` is an enum in the schema, which the executor enforces before this runs.
  const speed = args.speed === undefined ? 1 : Number(args.speed)
  if (!Number.isFinite(speed) || speed <= 0) fail(`speed must be a positive number (1 is the voice’s own pace), not ${String(args.speed)}.`)
  const target = args.targetSeconds === undefined ? undefined : Number(args.targetSeconds)
  if (target !== undefined && (!Number.isFinite(target) || target <= 0)) fail(`targetSeconds must be a positive number, not ${String(args.targetSeconds)}.`)

  const result = estimateSpeech(args.text, {
    ...(typeof args.language === 'string' ? { language: args.language } : {}),
    ...(args.pace !== undefined ? { pace: args.pace as SpeechPace } : {}),
    speed
  })
  const out: Record<string, unknown> = spoken(result)
  if (target !== undefined) {
    const over = Math.round((result.seconds - target) * 100) / 100
    out.target = { seconds: target, frames: framesOf(target), fits: over <= 0, ...(over > 0 ? { overBySeconds: over } : { spareSeconds: -over }) }
    if (over > 0) {
      const perSecond = result.units / Math.max(result.seconds, 0.01)
      out.next =
        `About ${Math.ceil(over * perSecond)} ${result.unit} too long at a ${result.pace} pace. Cut words, ` +
        (result.pace === 'fast' ? '' : 'or ask for a faster pace, ') +
        `and estimate again${result.range.fast <= target ? ` — at a fast pace it would fit (${result.range.fast}s)` : ''}.`
    }
  }
  return out
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

  let entries
  try {
    entries = await bridge.media.importPaths([job.outputPath])
  } catch (error) {
    fail(`The file landed at ${job.outputPath} but could not be imported: ${error instanceof Error ? error.message : String(error)}`)
  }
  const imported = entries[0]?.asset
  if (!imported || imported.error) {
    return {
      ...summarise(job),
      status: 'failed',
      error: `The file landed at ${job.outputPath} but could not be imported${imported?.error ? `: ${imported.error}` : ''}.`
    }
  }
  const measured =
    job.kind === 'speech'
      ? { measuredSeconds: Math.round(imported.durationUs / 10_000) / 100, estimatedSeconds: job.request.estimatedSeconds ?? null }
      : {}
  const asset = {
    id: imported.id,
    name: imported.name,
    kind: imported.kind,
    path: imported.path,
    durationInFrames: imported.durationUs > 0 ? usToFramesAtTimeline(imported.durationUs) : null,
    width: imported.width,
    height: imported.height,
    hasAudio: imported.hasAudio,
    hasVideo: imported.hasVideo
  }
  // Import and place are one undo step, like every other tool.
  // A refused placement (a locked or occupied track) still leaves the asset imported, and says
  // so: failing the whole call would hide that the paid-for file is already in the pool.
  let placed: Record<string, unknown> | undefined
  let placeError: string | undefined
  store().transact(() => {
    store().addAssets([imported])
    if (args.place !== true) return
    try {
      placed = placeAsset({
        assetId: imported.id,
        ...(args.atFrame !== undefined ? { atFrame: args.atFrame } : {}),
        ...(args.trackId !== undefined ? { trackId: args.trackId } : {})
      })
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      placeError = error.message
    }
  })
  const place = `place_asset { assetId: "${imported.id}" }`
  return {
    ...summarise(job),
    ...measured,
    asset,
    ...(placed ? { placed } : {}),
    ...(placeError ? { placeError, next: `The asset is imported but was not placed: ${placeError} Retry with ${place}.` } : {}),
    ...(!placed && !placeError ? { next: `The asset is in the media pool. Place it with ${place} where the edit needs it.` } : {})
  }
}

export const handlers: Handlers = {
  generate_image: (args) => generate('image', args),
  generate_video: (args) => generate('video', args),
  generate_speech: (args) => speak(args),
  estimate_speech: async (args) => estimate(args),
  track_generation: (args) => track(args)
}
