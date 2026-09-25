/**
 * `plan_dub`, `apply_dub` and `track_dub` — translate and dub, with the agent as the translator.
 *
 * bay does what a function can be trusted with (`@shared/dub`): the speech as sentence cues on
 * the timeline, each with the time its translated line may take; the check that a line fits
 * before anything is paid for; one speech job per line through main's spend guard; and, when the
 * lines have landed, their fit and placement as one undo step.
 *
 * Like `track_generation`, the jobs outlive the call. The job table is main's, and so, now, is
 * what a dub adds to it — which job is which cue, the lines not started yet because the
 * jobs-at-once limit was full, the plan, what was placed (`DubRecordData`, saved through
 * `generation.saveDub` after every change and read back after a reload). And main holds the dub's
 * whole estimated cost from the moment it is applied (`generation.reserve`), so a generation
 * started while the lines wait for room cannot spend the money they need.
 */

import {
  dubCues,
  dubInstructions,
  dubPlanId,
  dubTrackName,
  noRoomRefusal,
  fitTempo,
  overLongRefusal,
  readDubRecord,
  separateLines,
  speechBudget,
  suggestedCut,
  DUB_DUCK_DB,
  DUB_GAP_SECONDS,
  DUB_MAX_CUE_SECONDS,
  DUB_MUTE_DB,
  TEMPO_ACCEPT,
  TEMPO_WARN,
  type DubCue,
  type DubLineData,
  type DubLineStatus,
  type DubRecordData,
  type LineCheck,
  type OriginalAudio
} from '@shared/dub'
import { PROVIDERS, spendRefusal, type GenerationJob, type GenerationSpending } from '@shared/generation'
import { sentencesOf } from '@shared/highlights'
import { VALIDATE_ONLY } from '@shared/mcp'
import { allItems, findAsset, formatTimecode, framesToUs, usToFrames, US_PER_SECOND, type Item } from '@shared/project'
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
  planId: string
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
  const cues = dubCues(onTimeline, to, fps)
  const range = { from, to }
  return { item, language, fps, cues, range, planId: dubPlanId(item.id, range, cues) }
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
      text: cue.text,
    }
  })
  return {
    itemId: plan.item.id,
    language: plan.language,
    pace,
    range: plan.range,
    planId: plan.planId,
    cueCount: cues.length,
    cues,
    instructions: dubInstructions(plan.language),
    next:
      `Translate every cue, check the long ones with estimate_speech, then call apply_dub { itemId: "${plan.item.id}", ` +
      `language: "${plan.language}", planId: "${plan.planId}", translations: [{ cueId, text }, …], model, validateOnly: true }` +
      (args.fromFrame !== undefined || args.toFrame !== undefined ? ' with the same fromFrame/toFrame' : '') +
      ' to see the cost, and ask the user before the real call.'
  }
}

// ---------------------------------------------------------------------------
// Dubs in flight — kept by main, mirrored here
// ---------------------------------------------------------------------------

interface DubRecord extends DubRecordData {
  /** Serialises polls, so two at once cannot start a queued line twice or place twice. Not saved. */
  busy: Promise<unknown>
}

const dubs = new Map<string, DubRecord>()
let dubCounter = 0
/** Whether this window has read main's records yet. Once per window: a reload starts over. */
let loaded: Promise<void> | null = null

/** Forget every dub this window holds, as a reload does — for a test that starts each case clean. */
export function forgetDubs(): void {
  dubs.clear()
  loaded = null
}

/** Reads main's records once, so a dub applied before a reload is followed and placed after it. */
function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    let stored: unknown[] = []
    try {
      stored = await api().generation.dubs()
    } catch {
      stored = []
    }
    for (const raw of stored) {
      const data = readDubRecord(raw)
      if (data && !dubs.has(data.id)) dubs.set(data.id, { ...data, busy: Promise.resolve() })
    }
  })()
  return loaded
}

/** Saves a record in main. A save that fails leaves this window's copy working; the next save retries. */
async function persist(record: DubRecord): Promise<void> {
  const { busy: _busy, ...data } = record
  try {
    await api().generation.saveDub(structuredClone(data))
  } catch {
    // Kept in memory; the next change saves it again.
  }
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
    ...(spending.reservedUsd ? { heldForDubsUsd: spending.reservedUsd } : {}),
    spendNote: 'Estimated spend this session against the budget the user set in Preferences › AI providers. bay refuses a dub that would pass it.'
  }
}

async function applyDub(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dry = args[VALIDATE_ONLY] === true
  const plan = await buildPlan(args)
  if (plan.cues.length === 0) fail('No speech was found in the part of the clip asked for, so there is nothing to dub.')
  // The translations were written against a reading of the clip. If that reading has changed —
  // the clip moved, the range differs, the transcript was redone — they are for other cues.
  if (typeof args.planId === 'string' && args.planId !== plan.planId) {
    fail(
      `The clip no longer reads as the plan ${args.planId} did (it is now ${plan.planId}), so these translations may belong to other lines. ` +
        `Its cues are now ${plan.cues.map((c) => `${c.id} "${c.text.length > 40 ? `${c.text.slice(0, 39)}…` : c.text}"`).join(', ')}. ` +
        'Check each translation against these, or call plan_dub again, then call apply_dub with the new planId.'
    )
  }
  const translations = translationsOf(args, plan.cues)
  const mode: OriginalAudio = args.original === 'mute' || args.original === 'keep' ? args.original : 'duck'
  const amountDb = typeof args.duckDb === 'number' && Number.isFinite(args.duckDb) ? Math.min(40, Math.max(1, args.duckDb)) : DUB_DUCK_DB

  const cramped = noRoomRefusal(plan.cues, new Set(translations.keys()))
  if (cramped) fail(cramped)

  // Every line through the one speech validator: the same options, estimate and price
  // generate_speech would give it, with the target language for the estimate.
  const lines: DubLineData[] = []
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
    const reasons = new Set(invalid.map((line) => line.replace(/^c@[\d.]+: /, '')))
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
  const noKey = `No ${label} key is set, so this cannot run. Tell the user to add one in Preferences › AI providers (bay never takes keys in chat), then call this again.`
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
    planId: plan.planId,
    model: lines[0]!.request.model,
    voice: lines[0]!.request.voice,
    lines: planned.length,
    track: trackName,
    original:
      mode === 'duck'
        ? `ducked ${amountDb} dB under the dub`
        : mode === 'mute'
          ? `silenced (−${DUB_MUTE_DB} dB) under each dubbed line, and left as it is between them`
          : 'kept as it is',
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
  // Main holds the whole cost now, in the same step as its check, so what starts later cannot
  // find the budget gone. The check above is for the message; this is the lock.
  const held = await bridge.generation.reserve(total)
  if (!held.ok) fail(`The whole dub (${planned.length} lines) is estimated at $${total.toFixed(4)}. ${held.error}`)

  await ensureLoaded()
  dubCounter += 1
  const generation = 1 + Math.max(0, ...[...dubs.values()].filter((d) => d.trackName === trackName).map((d) => d.generation))
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
    planId: plan.planId,
    generation,
    reservationId: held.reservationId,
    busy: Promise.resolve()
  }
  dubs.set(record.id, record)
  await startQueued(record)
  await persist(record)
  const counts = countLines(record)
  return {
    dubId: record.id,
    ...common,
    ...counts,
    ...sessionSpend(await bridge.generation.spending()),
    next: `Call track_dub { dubId: "${record.id}" } every 15–30 seconds until it says the dub is placed, before your final answer.`
  }
}

/**
 * Starts queued lines while main's jobs-at-once limit has room. Main's guard still decides each
 * one: a refusal for room leaves the line queued for the next poll; any other refusal fails it
 * and the rest. Once nothing is left to start, main's hold on the budget is released.
 */
async function startQueued(record: DubRecord): Promise<void> {
  const bridge = api()
  for (const line of record.lines) {
    if (line.status !== 'queued') continue
    const spending = await bridge.generation.spending()
    if (spending.active >= spending.maxActive) break
    const started = await bridge.generation.start(line.request, record.reservationId ? { reservationId: record.reservationId } : undefined)
    if (!started.ok) {
      // Room taken between the look and the start (another generation got there first): not a
      // failure, the same line starts on a later poll.
      if (started.reason === 'room') break
      // Refused for another reason (the budget moved under us, a row that could not be written):
      // this line fails and says why, and the rest are not attempted, so one refusal cannot
      // become a run of them.
      line.status = 'failed'
      line.error = started.error
      for (const rest of record.lines) {
        if (rest.status === 'queued') {
          rest.status = 'failed'
          rest.error = `Not started: an earlier line was refused (${started.error}).`
        }
      }
      break
    }
    line.jobId = started.job.id
    line.status = started.job.status === 'failed' ? 'failed' : 'running'
    if (started.job.status === 'failed') line.error = started.job.error ?? 'the provider refused it'
  }
  if (record.reservationId && !record.lines.some((line) => line.status === 'queued')) {
    await bridge.generation.release(record.reservationId)
    delete record.reservationId
  }
}

function countLines(record: DubRecordData): Record<string, number> {
  const count = (status: DubLineStatus): number => record.lines.filter((line) => line.status === status).length
  return { done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') }
}

async function refresh(record: DubRecord): Promise<void> {
  const bridge = api()
  const landed: { line: DubLineData; job: GenerationJob }[] = []
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
function fitted(line: DubLineData, fps: number): { tempo: number; verdict: ReturnType<typeof fitTempo>['verdict']; durationInFrames: number } {
  const asset = line.asset!
  const { tempo, verdict } = fitTempo(asset.durationUs / US_PER_SECOND, line.cue.slotFrames / fps)
  let frames = usToFrames(asset.durationUs / tempo, fps)
  if (framesToUs(frames, fps) * tempo > asset.durationUs) frames -= 1
  return { tempo, verdict, durationInFrames: Math.max(1, Math.min(line.cue.slotFrames, frames)) }
}

/** The ids of every item on the open timeline. */
function itemIdsNow(): Set<string> {
  return new Set(allItems(timeline()).map((item) => item.id))
}

/**
 * Where dubs applied after this one have placed lines that still stand on the dub track: an
 * older dub finishing late must not lay its lines over those.
 */
function newerLines(record: DubRecordData): { from: number; to: number; dubId: string }[] {
  const track = timeline().tracks.find((t) => t.kind === 'audio' && t.name === record.trackName)
  if (!track) return []
  const owner = new Map<string, string>()
  for (const other of dubs.values()) {
    if (other.trackName !== record.trackName || other.generation <= record.generation) continue
    for (const id of other.placedItemIds ?? []) owner.set(id, other.id)
  }
  return track.items.filter((item) => owner.has(item.id)).map((item) => ({ from: item.from, to: item.from + item.durationInFrames, dubId: owner.get(item.id)! }))
}

async function place(record: DubRecord): Promise<Record<string, unknown>> {
  const fps = record.fps
  const candidates: { line: DubLineData; cueId: string; from: number; tempo: number; durationInFrames: number; verdict: string }[] = []
  const refused: string[] = []
  const skipped: string[] = []
  const newer = newerLines(record)
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
    const end = line.cue.fromFrame + fit.durationInFrames
    const over = newer.find((span) => line.cue.fromFrame < span.to && end > span.from)
    if (over) {
      skipped.push(`${line.cue.id}: not placed — ${over.dubId}, applied after this dub, already placed a line there.`)
      continue
    }
    candidates.push({ line, cueId: line.cue.id, from: line.cue.fromFrame, tempo: fit.tempo, durationInFrames: fit.durationInFrames, verdict: fit.verdict })
  }
  const separated = separateLines(candidates)
  const placing = separated.kept
  const failed = record.lines.filter((line) => line.status === 'failed').map((line) => `${line.cue.id}: ${line.error ?? 'failed'}`)
  const redo = [...refused.map((r) => r.split(':')[0]!), ...record.lines.filter((l) => l.status === 'failed').map((l) => l.cue.id)]

  let placement: Record<string, unknown> = {}
  if (placing.length > 0) {
    const placed = store().placeDub({
      trackName: record.trackName,
      clips: placing.map(({ line, from, tempo, durationInFrames }) => ({ asset: line.asset!, from, durationInFrames, speed: tempo })),
      original: { itemIds: [record.itemId], mode: record.original.mode, amountDb: record.original.amountDb }
    })
    if ('error' in placed) fail(`${placed.error} The ${placing.length} generated lines are kept; call track_dub again once it is fixed.`)
    record.placedItemIds = placed.itemIds
    placement = {
      trackId: placed.trackId,
      track: placed.trackName,
      ...(placed.replaced > 0 ? { replaced: `${placed.replaced} earlier dub line(s) where the new ones landed` } : {}),
      ...(placed.ducked.length > 0 ? { ducked: placed.ducked, duckDb: record.original.amountDb } : {}),
      ...(placed.muted.length > 0 ? { muted: placed.muted, muteNote: `silenced (−${DUB_MUTE_DB} dB) under each dubbed line; audible between them` } : {}),
      ...(placed.replacedDucks.length > 0
        ? {
            replacedDucks: placed.replacedDucks.map(
              (d) => `${d.itemId} was ducked under the track "${d.keyTrackName}"; that duck was replaced by the dub's. Undo takes it back, or set it again with edit_item.`
            )
          }
        : {}),
      ...(placed.lockedOriginals.length > 0
        ? { lockedOriginals: `${placed.lockedOriginals.join(', ')} left as they are: their track is locked.` }
        : {}),
      lines: placing.map(({ line, from, tempo, durationInFrames }, i) => ({
        cueId: line.cue.id,
        itemId: placed.itemIds[i],
        fromFrame: from,
        durationInFrames,
        measuredSeconds: line.measuredSeconds,
        slotSeconds: line.cue.slotSeconds,
        ...(tempo > 1 ? { tempo } : {})
      }))
    }
  } else {
    record.placedItemIds = []
  }
  const warned = placing
    .filter((p) => p.verdict === 'warn')
    .map((p) => `${p.line.cue.id} plays at ${p.tempo}× to fit its ${p.line.cue.slotSeconds}s slot — past the ${TEMPO_ACCEPT}× that sounds natural; listen to it, and shorten the line if it rushes.`)
  const captions = placing.map(({ line, from, durationInFrames }) => ({
    fromFrame: from,
    toFrame: from + durationInFrames,
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
    ...(skipped.length > 0 ? { skippedForNewerDub: skipped } : {}),
    ...(separated.trimmed.length > 0 ? { trimmed: `${separated.trimmed.join(', ')} ended early: the next line starts on the same stretch.` } : {}),
    ...(separated.dropped.length > 0 ? { dropped: `${separated.dropped.join(', ')} not placed: another line starts on the same frame.` } : {}),
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
  await ensureLoaded()
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
      `There is no dub "${id}". ` +
        (known.length > 0 ? `Dubs: ${known.join(', ')}.` : 'None has been started — call apply_dub first. (Its jobs, if any, are listed by track_generation.)')
    )
  }
  const run = record.busy.then(async () => {
    if (record.result) {
      // Placed, and still standing — or undone since. An undo takes the lines away, and polling
      // again puts them back from the files already generated: nothing is generated or paid again.
      const placedIds = record.placedItemIds ?? []
      const present = itemIdsNow()
      if (placedIds.length === 0 || placedIds.some((itemId) => present.has(itemId))) {
        return { ...record.result, note: 'Already placed; this is the same result. Undo takes the placement back.' }
      }
      const again = await place(record)
      record.result = again
      await persist(record)
      return {
        ...again,
        note: 'Its placed lines were gone from the timeline (an undo, or deleted), so they were placed again from the files already generated — nothing was generated or paid for again.'
      }
    }
    await refresh(record)
    const counts = countLines(record)
    if (counts.running! > 0 || counts.queued! > 0) {
      await persist(record)
      return {
        dubId: record.id,
        status: 'generating',
        ...counts,
        of: record.lines.length,
        next: 'Still generating. Call track_dub again in 15–30 seconds.'
      }
    }
    record.result = await place(record)
    await persist(record)
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
