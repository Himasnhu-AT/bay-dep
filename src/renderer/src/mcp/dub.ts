/**
 * `plan_dub`, `apply_dub` and `track_dub` — translate and dub, with the agent as the translator.
 *
 * bay does what a function can be trusted with (`@shared/dub`): the speech as sentence cues on
 * the timeline, each with the time its translated line may take; the check that a line fits
 * before anything is paid for; one speech job per line through main's spend guard; and, when the
 * lines have landed, their fit and placement as one undo step.
 *
 * Like `track_generation`, the jobs outlive the call. The job table is main's; what a dub adds —
 * which job is which cue, and which lines have not been started yet because the jobs-at-once
 * limit was full — is kept here, for this session. A reload forgets it; the jobs themselves are
 * still in main and can be placed one by one with track_generation.
 */

import { dubCues, dubInstructions, dubTrackName, fitTempo, overLongRefusal, speechBudget, suggestedCut, DUB_DUCK_DB, DUB_GAP_SECONDS, DUB_MAX_CUE_SECONDS, TEMPO_ACCEPT, TEMPO_WARN, type DubCue, type LineCheck, type OriginalAudio } from '@shared/dub'
import { PROVIDERS, spendRefusal, type GenerationJob, type GenerationRequest, type GenerationSpending } from '@shared/generation'
import { sentencesOf } from '@shared/highlights'
import { VALIDATE_ONLY } from '@shared/mcp'
import { findAsset, formatTimecode, framesToUs, usToFrames, US_PER_SECOND, type Asset, type Item } from '@shared/project'
import { validateSpeech } from '@shared/speech'
import type { SpeechPace } from '@shared/speech-duration'
import { segmentsToCues } from '@shared/transcribe'
import { bay } from '@/lib/bay'
import { fail, project, resolveItem, store, timeline, type Handlers } from './helpers'
import { transcribeSource } from './transcribe'

function api(): NonNullable<ReturnType<typeof bay>> {
  const bridge = bay()
  if (!bridge) fail('This window has no bridge to the app, so nothing can be dubbed.')
  return bridge
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round4 = (n: number): number => Math.round(n * 10000) / 10000

// ---------------------------------------------------------------------------
// The plan: cues and slots, shared by plan_dub and apply_dub
// ---------------------------------------------------------------------------

interface Plan {
  item: Item
  language: string
  fps: number
  cues: DubCue[]
  range: { from: number; to: number }
}

async function buildPlan(args: Record<string, unknown>): Promise<Plan> {
  const { item } = resolveItem(String(args.itemId ?? ''))
  const language = typeof args.language === 'string' ? args.language.trim() : ''
  if (!language) fail('language is empty. Pass the code of the language to dub into, such as "es" or "fr".')
  const asset = findAsset(project(), item.assetId)
  if (!asset?.path) fail(`${item.id} has no media file, so it has no speech to dub.`)
  if (!asset.hasAudio) fail(`${item.id} ("${asset.name}") has no audio track, so there is no speech to dub.`)

  const fps = timeline().fps
  const clipEnd = item.from + item.durationInFrames
  const from = typeof args.fromFrame === 'number' ? Math.max(item.from, args.fromFrame) : item.from
  const to = typeof args.toFrame === 'number' ? Math.min(clipEnd, args.toFrame) : clipEnd
  if (to <= from) {
    fail(`The range ${String(args.fromFrame ?? item.from)}–${String(args.toFrame ?? clipEnd)} leaves nothing of ${item.id}, which runs from ${item.from} to ${clipEnd}.`)
  }

  const sourceLanguage = typeof args.sourceLanguage === 'string' ? args.sourceLanguage : undefined
  const transcript = await transcribeSource(asset.path, sourceLanguage)
  // Sentences, closed at the dub's own gap tolerance and cut at a breath group's length, so one
  // generated line is one thought that fits between the speaker's pauses.
  const sentences = sentencesOf(transcript.segments, { pauseSeconds: DUB_GAP_SECONDS, maxSeconds: DUB_MAX_CUE_SECONDS })
  const onTimeline = segmentsToCues(sentences, item, fps).filter((cue) => cue.fromFrame >= from && cue.fromFrame < to)
  return { item, language, fps, cues: dubCues(onTimeline, to, fps), range: { from, to } }
}

function paceOf(value: unknown): SpeechPace {
  return value === 'slow' || value === 'fast' ? value : 'normal'
}

async function planDub(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const plan = await buildPlan(args)
  const pace = paceOf(args.pace)
  if (plan.cues.length === 0) {
    return {
      itemId: plan.item.id,
      language: plan.language,
      cues: [],
      next: 'No speech was found in the part of the clip asked for, so there is nothing to dub.'
    }
  }
  const cues = plan.cues.map((cue) => {
    const budget = speechBudget(cue.slotSeconds, plan.language, pace)
    return {
      cueId: cue.id,
      fromFrame: cue.fromFrame,
      toFrame: cue.toFrame,
      at: formatTimecode(cue.fromFrame, plan.fps, true),
      slotSeconds: cue.slotSeconds,
      budget: `about ${budget.about} ${budget.unit}`,
      text: cue.text
    }
  })
  return {
    itemId: plan.item.id,
    language: plan.language,
    pace,
    range: plan.range,
    cueCount: cues.length,
    cues,
    instructions: dubInstructions(plan.language),
    next:
      `Translate every cue, check the long ones with estimate_speech, then call apply_dub { itemId: "${plan.item.id}", ` +
      `language: "${plan.language}", translations: [{ cueId, text }, …], model, validateOnly: true }` +
      (args.fromFrame !== undefined || args.toFrame !== undefined ? ' with the same fromFrame/toFrame' : '') +
      ' to see the cost, and ask the user before the real call.'
  }
}

// ---------------------------------------------------------------------------
// Dubs in flight
// ---------------------------------------------------------------------------

type LineStatus = 'queued' | 'running' | 'done' | 'failed'

interface DubLine {
  cue: DubCue
  text: string
  request: GenerationRequest
  estimatedSeconds: number
  costUsd: number
  status: LineStatus
  jobId?: string
  error?: string
  asset?: Asset
  measuredSeconds?: number
}

interface DubRecord {
  id: string
  itemId: string
  language: string
  fps: number
  trackName: string
  original: { mode: OriginalAudio; amountDb: number }
  lines: DubLine[]
  totalEstimatedCostUsd: number
  createdAt: number
  /** Set once the lines are placed (or there was nothing to place): what every later poll returns. */
  result?: Record<string, unknown>
  /** Serialises polls, so two at once cannot start a queued line twice or place twice. */
  busy: Promise<unknown>
}

const dubs = new Map<string, DubRecord>()
let dubCounter = 0

/** Forget every dub — for a test that starts each case clean. */
export function forgetDubs(): void {
  dubs.clear()
}

function translationsOf(args: Record<string, unknown>, cues: readonly DubCue[]): Map<string, string> {
  const raw = Array.isArray(args.translations) ? (args.translations as unknown[]) : []
  if (raw.length === 0) fail('translations is empty. Pass { cueId, text } for each cue plan_dub returned.')
  const known = new Map(cues.map((cue) => [cue.id, cue]))
  const out = new Map<string, string>()
  const unknown: string[] = []
  const empty: string[] = []
  const twice: string[] = []
  for (const entry of raw) {
    const { cueId, text } = (entry ?? {}) as { cueId?: unknown; text?: unknown }
    const id = String(cueId ?? '')
    if (!known.has(id)) unknown.push(id || '(no cueId)')
    else if (typeof text !== 'string' || !text.trim()) empty.push(id)
    else if (out.has(id)) twice.push(id)
    else out.set(id, text.replace(/\s+/g, ' ').trim())
  }
  const faults: string[] = []
  if (unknown.length > 0) {
    faults.push(`There is no cue ${unknown.join(', ')} in this plan; its cues are ${cues.map((c) => c.id).join(', ')}. Call plan_dub again with the same itemId, language and range if the clip changed.`)
  }
  if (empty.length > 0) faults.push(`${empty.join(', ')} ${empty.length === 1 ? 'has' : 'have'} no text. Pass the translated words.`)
  if (twice.length > 0) faults.push(`${twice.join(', ')} ${twice.length === 1 ? 'is' : 'are'} translated twice. Pass one line per cue.`)
  const missing = cues.filter((cue) => !out.has(cue.id) && !empty.includes(cue.id)).map((cue) => cue.id)
  if (missing.length > 0 && args.partial !== true) {
    faults.push(`${missing.length} cue${missing.length === 1 ? ' has' : 's have'} no translation: ${missing.join(', ')}. Translate ${missing.length === 1 ? 'it' : 'them'} too, or pass partial: true to dub only the lines given.`)
  }
  if (faults.length > 0) fail(faults.join(' '))
  return out
}

function sessionSpend(spending: GenerationSpending): Record<string, unknown> {
  return {
    sessionSpendUsd: spending.spentUsd,
    sessionBudgetUsd: spending.budgetUsd,
    spendNote: 'Estimated spend this session against the budget the user set in Settings › Providers. bay refuses a dub that would pass it.'
  }
}

async function applyDub(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dry = args[VALIDATE_ONLY] === true
  const plan = await buildPlan(args)
  if (plan.cues.length === 0) fail('No speech was found in the part of the clip asked for, so there is nothing to dub.')
  const translations = translationsOf(args, plan.cues)
  const mode: OriginalAudio = args.original === 'mute' || args.original === 'keep' ? args.original : 'duck'
  const amountDb = typeof args.duckDb === 'number' && Number.isFinite(args.duckDb) ? Math.min(40, Math.max(1, args.duckDb)) : DUB_DUCK_DB

  // Every line through the one speech validator: the same options, estimate and price
  // generate_speech would give it, with the target language for the estimate.
  const lines: DubLine[] = []
  const invalid: string[] = []
  for (const cue of plan.cues) {
    const text = translations.get(cue.id)
    if (text === undefined) continue
    const checked = validateSpeech({
      model: args.model,
      text,
      language: plan.language,
      ...(args.voice !== undefined ? { voice: args.voice } : {}),
      ...(args.style !== undefined ? { style: args.style } : {}),
      ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
      ...(args.speed !== undefined ? { speed: args.speed } : {})
    })
    if (!checked.ok) {
      invalid.push(`${cue.id}: ${checked.errors.join(' ')}`)
      continue
    }
    lines.push({
      cue,
      text,
      request: checked.request,
      estimatedSeconds: checked.estimate.seconds,
      costUsd: checked.estimatedCostUsd,
      status: 'queued'
    })
  }
  if (invalid.length > 0) {
    // One option wrong is wrong on every line; say it once when it is.
    const reasons = new Set(invalid.map((line) => line.replace(/^c\d+: /, '')))
    fail(reasons.size === 1 ? [...reasons][0]! : invalid.join(' '))
  }

  const checks = lines.map((line) => ({ ...fitTempo(line.estimatedSeconds, line.cue.slotSeconds), cueId: line.cue.id, slotSeconds: line.cue.slotSeconds, estimatedSeconds: line.estimatedSeconds, text: line.text }) satisfies LineCheck & { text: string })
  const refusal = overLongRefusal(checks, plan.language)
  if (refusal) fail(refusal)

  const total = round4(lines.reduce((sum, line) => sum + line.costUsd, 0))
  const provider = lines[0]!.request.provider
  const label = PROVIDERS[provider].label
  const bridge = api()
  const keys = await bridge.generation.keys()
  const keySet = keys.some((k) => k.provider === provider && k.set)
  const noKey = `No ${label} key is set, so this cannot run. Tell the user to add one in Settings › Providers (bay never takes keys in chat), then call this again.`
  const spending = await bridge.generation.spending()
  // The whole dub against the budget, before any line starts: half a dub is money spent on
  // nothing usable. Jobs at once are not a refusal here — lines queue and start as slots free.
  const overBudget = spendRefusal({ ...spending, active: 0 }, total)
  const trackName = dubTrackName(plan.language)
  const planned = lines.map((line, i) => ({
    cueId: line.cue.id,
    fromFrame: line.cue.fromFrame,
    slotSeconds: line.cue.slotSeconds,
    estimatedSeconds: line.estimatedSeconds,
    ...(checks[i]!.tempo > 1 ? { tempo: checks[i]!.tempo } : {}),
    estimatedCostUsd: line.costUsd,
    text: line.text
  }))
  const spedUp = checks.filter((c) => c.tempo > 1).map((c) => `${c.cueId} (${c.tempo}×)`)
  const common = {
    itemId: plan.item.id,
    language: plan.language,
    model: lines[0]!.request.model,
    voice: lines[0]!.request.voice,
    lines: planned.length,
    track: trackName,
    original: mode === 'duck' ? `ducked ${amountDb} dB under the dub` : mode === 'mute' ? 'muted' : 'kept as it is',
    totalEstimatedCostUsd: total,
    costNote: 'An estimate from list prices, not a bill; the provider’s dashboard is the authority.',
    ...(spedUp.length > 0 ? { spedUpByEstimate: `Estimated a little long, so they will be sped up to fit: ${spedUp.join(', ')}.` } : {})
  }

  if (dry) {
    const blocked = !keySet ? noKey : overBudget
    return {
      valid: true,
      ...common,
      plan: planned,
      keySet,
      ...sessionSpend(spending),
      ...(blocked ? { blocked } : {}),
      next: blocked
        ? 'Tell the user what blocks it; do not call apply_dub for real until it is resolved.'
        : `Tell the user the dub costs about $${total.toFixed(4)} for ${planned.length} line${planned.length === 1 ? '' : 's'} and ask before calling apply_dub without validateOnly.`
    }
  }

  if (!keySet) fail(noKey)
  if (overBudget) fail(`The whole dub (${planned.length} lines) is estimated at $${total.toFixed(4)}. ${overBudget}`)

  dubCounter += 1
  const record: DubRecord = {
    id: `dub-${Date.now().toString(36)}${dubCounter.toString(36)}`,
    itemId: plan.item.id,
    language: plan.language,
    fps: plan.fps,
    trackName,
    original: { mode, amountDb },
    lines,
    totalEstimatedCostUsd: total,
    createdAt: Date.now(),
    busy: Promise.resolve()
  }
  dubs.set(record.id, record)
  await startQueued(record)
  const counts = countLines(record)
  return {
    dubId: record.id,
    ...common,
    ...counts,
    ...sessionSpend(await bridge.generation.spending()),
    next: `Call track_dub { dubId: "${record.id}" } every 15–30 seconds until it says the dub is placed, before your final answer.`
  }
}

/** Starts queued lines while main's jobs-at-once limit has room. Main's guard still decides each one. */
async function startQueued(record: DubRecord): Promise<void> {
  const bridge = api()
  for (const line of record.lines) {
    if (line.status !== 'queued') continue
    const spending = await bridge.generation.spending()
    if (spending.active >= spending.maxActive) return
    const started = await bridge.generation.start(line.request)
    if (!started.ok) {
      // Refused by the guard for a reason other than room (the budget moved under us, a row that
      // could not be written): this line fails and says why, and the rest are not attempted, so
      // one refusal cannot become a run of them.
      line.status = 'failed'
      line.error = started.error
      for (const rest of record.lines) {
        if (rest.status === 'queued') {
          rest.status = 'failed'
          rest.error = `Not started: an earlier line was refused (${started.error}).`
        }
      }
      return
    }
    line.jobId = started.job.id
    line.status = started.job.status === 'failed' ? 'failed' : 'running'
    if (started.job.status === 'failed') line.error = started.job.error ?? 'the provider refused it'
  }
}

function countLines(record: DubRecord): Record<string, number> {
  const count = (status: LineStatus): number => record.lines.filter((line) => line.status === status).length
  return { done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') }
}

async function refresh(record: DubRecord): Promise<void> {
  const bridge = api()
  const landed: { line: DubLine; job: GenerationJob }[] = []
  for (const line of record.lines) {
    if (line.status !== 'running' || !line.jobId) continue
    const job = await bridge.generation.job(line.jobId)
    if (!job) {
      line.status = 'failed'
      line.error = `main has no job ${line.jobId} any more.`
    } else if (job.status === 'failed') {
      line.status = 'failed'
      line.error = job.error ?? 'the job failed without a reason'
    } else if (job.status === 'done') {
      if (!job.outputPath) {
        line.status = 'failed'
        line.error = 'the job finished but main recorded no file for it'
      } else landed.push({ line, job })
    }
  }
  if (landed.length > 0) {
    let entries: Awaited<ReturnType<typeof bridge.media.importPaths>>
    try {
      entries = await bridge.media.importPaths(landed.map(({ job }) => job.outputPath!))
    } catch (error) {
      fail(`The generated lines landed but could not be imported: ${error instanceof Error ? error.message : String(error)}. Call track_dub again to retry.`)
    }
    landed.forEach(({ line, job }, i) => {
      const asset = entries[i]?.asset
      if (!asset || asset.error || !(asset.durationUs > 0)) {
        line.status = 'failed'
        line.error = `the file at ${job.outputPath} could not be imported${asset?.error ? ` (${asset.error})` : ''}`
        return
      }
      line.status = 'done'
      line.asset = { ...asset, name: `Dub ${record.language} · ${line.cue.id}` }
      line.measuredSeconds = round2(asset.durationUs / US_PER_SECOND)
    })
  }
  await startQueued(record)
}

/** A line's clip on the timeline: at its cue, at the tempo that fits its slot, never past its own footage. */
function fitted(line: DubLine, fps: number): { tempo: number; verdict: ReturnType<typeof fitTempo>['verdict']; durationInFrames: number } {
  const asset = line.asset!
  const { tempo, verdict } = fitTempo(asset.durationUs / US_PER_SECOND, line.cue.slotFrames / fps)
  let frames = usToFrames(asset.durationUs / tempo, fps)
  if (framesToUs(frames, fps) * tempo > asset.durationUs) frames -= 1
  return { tempo, verdict, durationInFrames: Math.max(1, Math.min(line.cue.slotFrames, frames)) }
}

async function place(record: DubRecord): Promise<Record<string, unknown>> {
  const fps = record.fps
  const placing: { line: DubLine; tempo: number; durationInFrames: number; verdict: string }[] = []
  const refused: string[] = []
  for (const line of record.lines) {
    if (line.status !== 'done' || !line.asset) continue
    const fit = fitted(line, fps)
    if (fit.verdict === 'refuse') {
      const { cut, keep } = suggestedCut(line.text, line.measuredSeconds!, line.cue.slotSeconds)
      refused.push(
        `${line.cue.id}: generated ${line.measuredSeconds}s for a ${line.cue.slotSeconds}s slot (needs ${fit.tempo}×, beyond the ${TEMPO_WARN}× bay allows). ` +
          `Cut about ${cut} characters (to ${keep} or fewer).`
      )
      continue
    }
    placing.push({ line, tempo: fit.tempo, durationInFrames: fit.durationInFrames, verdict: fit.verdict })
  }
  const failed = record.lines.filter((line) => line.status === 'failed').map((line) => `${line.cue.id}: ${line.error ?? 'failed'}`)
  const redo = [...refused.map((r) => r.split(':')[0]!), ...record.lines.filter((l) => l.status === 'failed').map((l) => l.cue.id)]

  let placement: Record<string, unknown> = {}
  if (placing.length > 0) {
    const placed = store().placeDub({
      trackName: record.trackName,
      clips: placing.map(({ line, tempo, durationInFrames }) => ({ asset: line.asset!, from: line.cue.fromFrame, durationInFrames, speed: tempo })),
      original: { itemIds: [record.itemId], mode: record.original.mode, amountDb: record.original.amountDb }
    })
    if ('error' in placed) fail(`${placed.error} The ${placing.length} generated lines are kept; call track_dub again once it is fixed.`)
    placement = {
      trackId: placed.trackId,
      track: placed.trackName,
      ...(placed.replaced > 0 ? { replaced: `${placed.replaced} earlier dub line(s) where the new ones landed` } : {}),
      ...(placed.ducked.length > 0 ? { ducked: placed.ducked, duckDb: record.original.amountDb } : {}),
      ...(placed.muted.length > 0 ? { muted: placed.muted } : {}),
      ...(placed.lockedOriginals.length > 0
        ? { lockedOriginals: `${placed.lockedOriginals.join(', ')} left as they are: their track is locked.` }
        : {}),
      lines: placing.map(({ line, tempo, durationInFrames }, i) => ({
        cueId: line.cue.id,
        itemId: placed.itemIds[i],
        fromFrame: line.cue.fromFrame,
        durationInFrames,
        measuredSeconds: line.measuredSeconds,
        slotSeconds: line.cue.slotSeconds,
        ...(tempo > 1 ? { tempo } : {})
      }))
    }
  }
  const warned = placing
    .filter((p) => p.verdict === 'warn')
    .map((p) => `${p.line.cue.id} plays at ${p.tempo}× to fit its ${p.line.cue.slotSeconds}s slot — past the ${TEMPO_ACCEPT}× that sounds natural; listen to it, and shorten the line if it rushes.`)
  const captions = placing.map(({ line, durationInFrames }) => ({
    fromFrame: line.cue.fromFrame,
    toFrame: line.cue.fromFrame + durationInFrames,
    text: line.text
  }))
  return {
    dubId: record.id,
    status: placing.length > 0 ? 'placed' : 'nothing placed',
    ...countLines(record),
    placed: placing.length,
    ...placement,
    ...(warned.length > 0 ? { warnings: warned } : {}),
    ...(refused.length > 0 ? { refused } : {}),
    ...(failed.length > 0 ? { failedLines: failed } : {}),
    ...(captions.length > 0 ? { captionCues: captions } : {}),
    next:
      (redo.length > 0
        ? `Rewrite or retry ${redo.join(', ')} and call apply_dub with partial: true and just those lines. `
        : '') +
      (placing.length > 0
        ? 'Check the result with frame_grid or preview_frame over a dubbed stretch; pass captionCues to add_captions for translated subtitles if the user wants them.'
        : 'Nothing was placed.')
  }
}

async function trackDub(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (args.dubId === undefined) {
    return {
      dubs: [...dubs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((d) => ({ dubId: d.id, language: d.language, itemId: d.itemId, ...countLines(d), placed: d.result !== undefined }))
    }
  }
  const id = String(args.dubId)
  const record = dubs.get(id)
  if (!record) {
    const known = [...dubs.keys()]
    fail(
      `There is no dub "${id}" this session. ` +
        (known.length > 0 ? `Dubs: ${known.join(', ')}.` : 'None has been started — call apply_dub first. (A reload forgets dubs; their jobs are listed by track_generation.)')
    )
  }
  const run = record.busy.then(async () => {
    if (record.result) return { ...record.result, note: 'Already placed; this is the same result. Undo takes the placement back.' }
    await refresh(record)
    const counts = countLines(record)
    if (counts.running! > 0 || counts.queued! > 0) {
      return {
        dubId: record.id,
        status: 'generating',
        ...counts,
        of: record.lines.length,
        next: 'Still generating. Call track_dub again in 15–30 seconds.'
      }
    }
    record.result = await place(record)
    return record.result
  })
  record.busy = run.catch(() => undefined)
  return run
}

export const handlers: Handlers = {
  plan_dub: (args) => planDub(args),
  apply_dub: (args) => applyDub(args),
  track_dub: (args) => trackDub(args)
}
