/**
 * `detect_footage_mode` — what kind of footage this is, and what to reach for.
 *
 * Gathers per-file signals bay already has (probe data on the asset, a transcript this session
 * made, cuts `detect_cuts` found, a beat grid) and, where the speech signal is missing, a quick
 * `silencedetect` over the first two minutes of the longest files. The classifier and the
 * mode → actions table are `@shared/footage-mode`, which the UI imports too.
 */

import { classifyFootage, FOOTAGE_MODES, type FootageAssetSignal } from '@shared/footage-mode'
import { bay } from '@/lib/bay'
import { project, type Handlers } from './helpers'
import { anyTranscriptFor } from './transcribe'
import { cachedCuts } from './cuts'

/** How much of a file the quick analysis reads, and how many files it reads at most. */
const SAMPLE_SEC = 120
const MAX_ANALYSED = 6
/** Quieter than a voice, louder than room tone: the activity gate for the quick analysis (heuristic). */
const ACTIVITY_THRESHOLD_DB = -35
const ACTIVITY_MIN_SILENCE_SEC = 0.3

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places

export async function detectFootageMode(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const assets = project().assets.filter((a) => (a.kind === 'video' || a.kind === 'audio') && a.path && !a.error)
  const signals: (FootageAssetSignal & { path: string })[] = assets.map((asset) => {
    const durationSec = asset.durationUs / 1_000_000
    const transcript = anyTranscriptFor(asset.path!)
    const spoken = transcript ? transcript.segments.reduce((sum, s) => sum + Math.max(0, s.endSeconds - s.startSeconds), 0) : null
    const cuts = asset.kind === 'video' ? cachedCuts(asset.path!) : undefined
    return {
      path: asset.path!,
      name: asset.name,
      kind: asset.kind as 'video' | 'audio',
      durationSec: round(durationSec, 2),
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      hasAudio: asset.hasAudio,
      channels: asset.channels ?? null,
      speechRatio: spoken !== null && durationSec > 0 ? round(Math.min(1, spoken / durationSec)) : null,
      activityRatio: null,
      cutsPerMin: cuts && durationSec > 0 ? round(cuts.length / (durationSec / 60), 2) : null,
      beatConfidence: asset.beats ? asset.beats.confidence : null
    }
  })

  const notes: string[] = []
  const api = bay()
  if (args.analyzeAudio !== false && api) {
    const wanting = signals
      .filter((s) => s.hasAudio && s.speechRatio === null && s.durationSec > 0)
      .sort((a, b) => b.durationSec - a.durationSec)
      .slice(0, MAX_ANALYSED)
    for (const signal of wanting) {
      const sampleSec = Math.min(SAMPLE_SEC, signal.durationSec)
      const result = await api.media.silences(signal.path, { startUs: 0, durationUs: Math.round(sampleSec * 1_000_000) }, ACTIVITY_THRESHOLD_DB, ACTIVITY_MIN_SILENCE_SEC)
      if (!result.ok) {
        notes.push(`could not analyse "${signal.name}": ${result.error}`)
        continue
      }
      const silent = result.value.reduce((sum, s) => sum + (s.endSec - s.startSec), 0)
      signal.activityRatio = round(Math.max(0, 1 - silent / sampleSec))
    }
  }

  const classification = classifyFootage({ assets: signals })
  const info = FOOTAGE_MODES[classification.mode]
  return {
    mode: classification.mode,
    label: info.label,
    confidence: classification.confidence,
    reasons: classification.reasons,
    signals: {
      ...classification.summary,
      files: signals.map(({ path: _path, ...rest }) => rest)
    },
    suggestedTools: info.tools,
    suggestedSkills: info.skills,
    suggestedLayout: info.layout,
    actions: info.actions.map((a) => ({ label: a.label, prompt: a.prompt })),
    ...(notes.length > 0 ? { notes } : {}),
    next:
      classification.confidence < 0.5
        ? 'Low confidence: tell the user what you see and ask what they want before acting on this.'
        : `Tell the user this looks like ${info.label.toLowerCase()} and why (reasons), then offer the actions.` +
          (classification.summary.speechSource === 'silence analysis'
            ? ' Speech was estimated from silence, which cannot tell talk from music; transcribe a clip if it matters.'
            : '')
  }
}

export const handlers: Handlers = {
  detect_footage_mode: (args) => detectFootageMode(args)
}
