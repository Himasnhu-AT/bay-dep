/**
 * "Smart mode": what kind of footage a project holds, from signals bay can compute on this Mac,
 * and what to offer for it. `detect_footage_mode` gathers the signals; the classifier and the
 * mode → actions table are here so the UI (the AI layout's tool palette) can import them too.
 *
 * **Every threshold in this file is a heuristic** — a first guess, not measured against a labelled
 * set of projects (r&d/research/podclip.md §6.2 names ~30 as the evaluation it needs). They are
 * named constants so the evaluation, when it happens, changes numbers and not logic. Two
 * corrections from the audit (r&d/research/audit.md §8.5) are built in: no signal compares
 * `search_footage` scores across queries (they are only comparable within one search), and fps is
 * read from the asset in-app, which the agent's own tools do not return.
 *
 * Rules run in order and the first that matches wins; nothing matching is `mixed`. When the speech
 * signal is missing (no transcript, no audio analysed) a rule that wanted it still matches on the
 * other signals, at a lower confidence, and says so in `reasons`.
 */

export type FootageMode = 'podcast' | 'talking-head' | 'screen-recording' | 'b-roll-pile' | 'music-video' | 'mixed'

/** What is known about one imported file. Absent or null means "not measured", never zero. */
export interface FootageAssetSignal {
  name: string
  kind: 'video' | 'audio'
  durationSec: number
  width?: number | null
  height?: number | null
  fps?: number | null
  hasAudio: boolean
  channels?: number | null
  /** Share of the file covered by transcribed speech (from a transcript this session already has). */
  speechRatio?: number | null
  /** Share of the sampled audio that is not silence (silencedetect): speech *or* music. */
  activityRatio?: number | null
  /** Shot changes per minute (from detect_cuts, when it has run on this file). */
  cutsPerMin?: number | null
  /** detect_beats' confidence, when the file has been analysed. */
  beatConfidence?: number | null
}

export interface FootageSignals {
  assets: FootageAssetSignal[]
}

// --- Heuristics (see the file comment) --------------------------------------------------------

/** Two recordings of one event: durations within 2% of each other. */
export const MATCHING_DURATION_TOLERANCE = 0.02
/** A podcast's recordings are long; a pair of matching 20-second clips is not a show. */
export const PODCAST_MIN_SEC = 180
/** Speech-heavy: half the time or more is words. */
export const SPEECH_HEAVY = 0.5
/** Hardly any words. */
export const SPEECH_LIGHT = 0.15
/** A talking head is one take of a minute or more. */
export const TALKING_HEAD_MIN_SEC = 60
/** …that carries most of the footage. */
export const DOMINANT_SHARE = 0.7
/** …and is not already cut up. */
export const TALKING_HEAD_MAX_CUTS_PER_MIN = 1
/** Screen recordings rarely cut. */
export const SCREEN_MAX_CUTS_PER_MIN = 0.5
/** A B-roll pile: at least this many clips… */
export const BROLL_MIN_CLIPS = 5
/** …mostly short. */
export const BROLL_MAX_MEDIAN_SEC = 30
/** A music bed: a steady beat. */
export const MUSIC_BEAT_CONFIDENCE = 0.5
/** A supplied edit this busy is a montage or a music video. */
export const MONTAGE_CUTS_PER_MIN = 15

/** Display resolutions a Mac or PC records its screen at, which cameras do not shoot. */
const SCREEN_SIZES = new Set([
  '2880x1800', '3024x1964', '3456x2234', '2560x1600', '1440x900', '1680x1050', '1920x1200', '2560x1440',
  '3840x2400', '5120x2880', '2940x1912', '3024x1890', '1512x982', '1728x1117', '1470x956'
])

export interface FootageClassification {
  mode: FootageMode
  /** 0..1: how sure the rule is. Lowered when the speech signal it wanted was not measured. */
  confidence: number
  /** One line per piece of evidence, for the agent to repeat to the user. */
  reasons: string[]
  /** The aggregate numbers the rules read. */
  summary: FootageSummary
}

export interface FootageSummary {
  videoCount: number
  audioCount: number
  totalVideoSec: number
  /** The largest set of recordings (video or audio with sound) whose durations match, at least PODCAST_MIN_SEC long. */
  matchingGroup: string[]
  /** Duration-weighted speech share of the sound-carrying files, or null when none was measured. */
  speech: number | null
  /** Where `speech` came from. */
  speechSource: 'transcript' | 'silence analysis' | 'mixed' | null
  medianVideoSec: number | null
  /** The longest video's share of all video time. */
  dominantShare: number | null
  screenLikeShare: number
  hasMusicBed: boolean
  maxCutsPerMin: number | null
}

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** A file whose frame size is a display's, or 16:10, and not a camera's. */
export function screenLike(asset: FootageAssetSignal): boolean {
  if (asset.kind !== 'video' || !asset.width || !asset.height) return false
  if (SCREEN_SIZES.has(`${asset.width}x${asset.height}`)) return true
  return Math.abs(asset.width / asset.height - 1.6) < 0.01
}

function speechOf(asset: FootageAssetSignal): { value: number; source: 'transcript' | 'silence analysis' } | null {
  if (typeof asset.speechRatio === 'number') return { value: asset.speechRatio, source: 'transcript' }
  if (typeof asset.activityRatio === 'number') return { value: asset.activityRatio, source: 'silence analysis' }
  return null
}

/** Recordings grouped by matching duration; the largest group of long ones. */
function matchingGroup(assets: readonly FootageAssetSignal[]): FootageAssetSignal[] {
  const candidates = assets.filter((a) => a.hasAudio && a.durationSec >= PODCAST_MIN_SEC)
  let best: FootageAssetSignal[] = []
  for (const anchor of candidates) {
    const group = candidates.filter((a) => Math.abs(a.durationSec - anchor.durationSec) <= anchor.durationSec * MATCHING_DURATION_TOLERANCE)
    if (group.length > best.length) best = group
  }
  return best
}

export function summarise(signals: FootageSignals): FootageSummary {
  const videos = signals.assets.filter((a) => a.kind === 'video')
  const audios = signals.assets.filter((a) => a.kind === 'audio')
  const totalVideoSec = videos.reduce((sum, a) => sum + a.durationSec, 0)
  const group = matchingGroup(signals.assets)
  const voiced = signals.assets.filter((a) => a.hasAudio)
  let weighted = 0
  let weight = 0
  const sources = new Set<string>()
  for (const asset of voiced) {
    const speech = speechOf(asset)
    if (!speech) continue
    weighted += speech.value * asset.durationSec
    weight += asset.durationSec
    sources.add(speech.source)
  }
  const longest = videos.reduce((max, a) => Math.max(max, a.durationSec), 0)
  const screenSec = videos.filter(screenLike).reduce((sum, a) => sum + a.durationSec, 0)
  const cutRates = signals.assets.map((a) => a.cutsPerMin).filter((c): c is number => typeof c === 'number')
  const hasMusicBed = audios.some(
    (a) => (a.beatConfidence ?? 0) >= MUSIC_BEAT_CONFIDENCE && (a.speechRatio ?? 0) < SPEECH_LIGHT
  )
  return {
    videoCount: videos.length,
    audioCount: audios.length,
    totalVideoSec: round(totalVideoSec, 1),
    matchingGroup: group.map((a) => a.name),
    speech: weight > 0 ? round(weighted / weight) : null,
    speechSource: sources.size === 0 ? null : sources.size > 1 ? 'mixed' : (([...sources][0] as 'transcript' | 'silence analysis')),
    medianVideoSec: median(videos.map((a) => a.durationSec)),
    dominantShare: totalVideoSec > 0 ? round(longest / totalVideoSec) : null,
    screenLikeShare: totalVideoSec > 0 ? round(screenSec / totalVideoSec) : 0,
    hasMusicBed,
    maxCutsPerMin: cutRates.length > 0 ? Math.max(...cutRates) : null
  }
}

/** The rules, in order. */
export function classifyFootage(signals: FootageSignals): FootageClassification {
  const s = summarise(signals)
  const reasons: string[] = []
  const speechKnown = s.speech !== null
  // Silence analysis cannot tell speech from music, so it counts for less than words do.
  const speechWeight = s.speechSource === 'transcript' ? 1 : speechKnown ? 0.85 : 0.65
  const speechLine = speechKnown
    ? `speech ${Math.round(s.speech! * 100)}% (from ${s.speechSource})`
    : 'speech not measured (no transcript or audio analysis)'
  const result = (mode: FootageMode, base: number): FootageClassification => ({
    mode,
    confidence: round(Math.max(0, Math.min(1, base))),
    reasons,
    summary: s
  })

  if (s.videoCount === 0 && s.audioCount === 0) {
    reasons.push('no video or audio has been imported yet')
    return result('mixed', 0)
  }

  // Podcast: two or more long recordings of one event, speech-heavy — but one camera with one
  // separate mic is a talking head recorded with a lav, not a conversation.
  const group = signals.assets.filter((a) => s.matchingGroup.includes(a.name))
  const groupVideos = group.filter((a) => a.kind === 'video').length
  const cameraPlusLav = group.length === 2 && groupVideos === 1
  if (group.length >= 2 && !cameraPlusLav && (!speechKnown || s.speech! >= SPEECH_HEAVY)) {
    reasons.push(`${s.matchingGroup.length} recordings of matching length (${s.matchingGroup.join(', ')})`, speechLine)
    return result('podcast', (s.matchingGroup.length >= 3 ? 0.9 : 0.8) * speechWeight)
  }

  // Music video / montage: a music bed under several clips, or an edit already cutting fast.
  if ((s.hasMusicBed && s.videoCount >= 2) || (s.maxCutsPerMin !== null && s.maxCutsPerMin >= MONTAGE_CUTS_PER_MIN)) {
    if (s.hasMusicBed) reasons.push('an audio file with a steady beat and hardly any words')
    if (s.maxCutsPerMin !== null && s.maxCutsPerMin >= MONTAGE_CUTS_PER_MIN) reasons.push(`footage already cut at ${round(s.maxCutsPerMin, 1)} shots a minute`)
    reasons.push(`${s.videoCount} video clips`)
    return result('music-video', s.hasMusicBed ? 0.8 : 0.65)
  }

  // Screen recording: most of the picture is at a display's size, and it barely cuts.
  if (s.screenLikeShare >= 0.5 && (s.maxCutsPerMin === null || s.maxCutsPerMin <= SCREEN_MAX_CUTS_PER_MIN)) {
    reasons.push(`${Math.round(s.screenLikeShare * 100)}% of the video is at a screen's resolution or 16:10`, speechLine)
    return result('screen-recording', 0.75)
  }

  // Talking head: one long take carries the footage, and it is words.
  const longest = [...signals.assets].filter((a) => a.kind === 'video').sort((a, b) => b.durationSec - a.durationSec)[0]
  if (
    longest &&
    (longest.hasAudio || cameraPlusLav) &&
    longest.durationSec >= TALKING_HEAD_MIN_SEC &&
    (s.dominantShare ?? 0) >= DOMINANT_SHARE &&
    (!speechKnown || s.speech! >= SPEECH_HEAVY) &&
    (longest.cutsPerMin === null || longest.cutsPerMin === undefined || longest.cutsPerMin < TALKING_HEAD_MAX_CUTS_PER_MIN)
  ) {
    reasons.push(`one take, "${longest.name}", is ${Math.round((s.dominantShare ?? 0) * 100)}% of the video (${Math.round(longest.durationSec)} s)`, speechLine)
    return result('talking-head', 0.8 * speechWeight)
  }

  // B-roll pile: many short clips, hardly any words.
  if (s.videoCount >= BROLL_MIN_CLIPS && (s.medianVideoSec ?? Infinity) < BROLL_MAX_MEDIAN_SEC && (!speechKnown || s.speech! < SPEECH_LIGHT)) {
    reasons.push(`${s.videoCount} video clips, median ${Math.round(s.medianVideoSec!)} s`, speechLine)
    return result('b-roll-pile', 0.8 * (speechKnown ? 1 : 0.8))
  }

  reasons.push(
    `${s.videoCount} video and ${s.audioCount} audio file${s.audioCount === 1 ? '' : 's'}; no single kind of footage stands out`,
    speechLine
  )
  return result('mixed', 0.4)
}

// --- What to offer --------------------------------------------------------------------------

/**
 * One button in the tool palette. `prompt` is what to send the in-app agent (it names the skill
 * with a leading `/`, which loads it); `tool` is a direct call for actions that need no judgement.
 * `icon` is a lucide-react icon name, as a hint — the palette may draw its own.
 */
export interface FootageAction {
  id: string
  label: string
  icon: string
  prompt: string
  tool?: { name: string; args: Record<string, unknown> }
}

export interface FootageModeInfo {
  label: string
  /** Which workspace suits it: the agent-led AI layout, or Resolve's pages. */
  layout: 'ai' | 'resolve'
  skills: string[]
  tools: string[]
  actions: FootageAction[]
}

export const FOOTAGE_MODES: Record<FootageMode, FootageModeInfo> = {
  podcast: {
    label: 'Podcast',
    layout: 'ai',
    skills: ['podcast', 'highlights', 'captions', 'chapters'],
    tools: ['sync_angles', 'switch_speakers', 'remove_silences', 'level_voices', 'add_subtitles', 'find_highlights'],
    actions: [
      { id: 'podcast-edit', label: 'Edit the podcast', icon: 'Mic', prompt: '/podcast Sync the angles, cut between speakers, remove the silences and balance the voices.' },
      { id: 'sync-angles', label: 'Sync by audio', icon: 'AudioWaveform', prompt: 'Line up the camera angles and mics of this recording by their sound (sync_angles).' },
      { id: 'switch-speakers', label: 'Auto-switch speakers', icon: 'SwitchCamera', prompt: '/podcast Cut between the camera angles by whoever is speaking (switch_speakers).' },
      { id: 'remove-silences', label: 'Remove silences', icon: 'Scissors', prompt: 'Remove the silences across the whole conversation (remove_silences), keeping a breath at each cut.' },
      { id: 'level-voices', label: 'Balance speakers', icon: 'SlidersHorizontal', prompt: 'Match every speaker to the same loudness (level_voices).' },
      { id: 'make-clips', label: 'Make 3 clips', icon: 'Sparkles', prompt: '/highlights Find the three best moments for short clips.' }
    ]
  },
  'talking-head': {
    label: 'Talking head',
    layout: 'ai',
    skills: ['talking-head', 'captions', 'short-form'],
    tools: ['remove_silences', 'transcribe', 'add_subtitles', 'find_highlights', 'level_voices'],
    actions: [
      { id: 'tighten', label: 'Tighten the take', icon: 'Scissors', prompt: '/talking-head Remove the silences, false starts and repeated lines.' },
      { id: 'remove-silences', label: 'Remove silences', icon: 'AudioLines', prompt: 'Remove the silences from the recording (remove_silences), keeping a breath at each cut.' },
      { id: 'subtitles', label: 'Add subtitles', icon: 'Captions', prompt: '/captions Add word-by-word subtitles.' },
      { id: 'make-clips', label: 'Make 3 clips', icon: 'Sparkles', prompt: '/short-form Make three vertical clips from the best moments.' }
    ]
  },
  'screen-recording': {
    label: 'Screen recording',
    layout: 'ai',
    skills: ['captions', 'chapters'],
    tools: ['remove_silences', 'transcribe', 'add_captions', 'add_marker'],
    actions: [
      { id: 'remove-silences', label: 'Remove dead air', icon: 'Scissors', prompt: 'Remove the pauses in the narration (remove_silences).' },
      { id: 'chapters', label: 'Add chapters', icon: 'ListOrdered', prompt: '/chapters Mark a chapter at each new topic.' },
      { id: 'captions', label: 'Add captions', icon: 'Captions', prompt: '/captions Add clean captions.' }
    ]
  },
  'b-roll-pile': {
    label: 'B-roll',
    layout: 'resolve',
    skills: ['rough-cut'],
    tools: ['index_footage', 'search_footage', 'detect_cuts', 'detect_beats', 'frame_grid'],
    actions: [
      { id: 'index', label: 'Index footage', icon: 'ScanSearch', prompt: 'Index these clips so I can search them by what is in them (index_footage).' },
      { id: 'rough-cut', label: 'Rough cut', icon: 'Film', prompt: '/rough-cut Assemble the strongest shots into a rough cut.' },
      { id: 'cut-to-music', label: 'Cut to music', icon: 'Music', prompt: 'Find the beat of the music (detect_beats) and cut the shots to it.' }
    ]
  },
  'music-video': {
    label: 'Music video',
    layout: 'resolve',
    skills: ['transitions', 'rough-cut'],
    tools: ['detect_beats', 'detect_cuts', 'add_transition', 'split_at'],
    actions: [
      { id: 'beats', label: 'Find the beat', icon: 'Music', prompt: 'Find the beat of the song (detect_beats) and mark the bars.' },
      { id: 'cut-to-beat', label: 'Cut on the beat', icon: 'Scissors', prompt: 'Cut the footage to the song, with the big changes on downbeats.' },
      { id: 'transitions', label: 'Transitions', icon: 'Blend', prompt: '/transitions Add transitions that suit the music.' }
    ]
  },
  mixed: {
    label: 'Mixed footage',
    layout: 'resolve',
    skills: ['review', 'rough-cut'],
    tools: ['browse_assets', 'frame_grid', 'transcribe', 'detect_cuts'],
    actions: [
      { id: 'detect', label: 'What is this footage?', icon: 'Wand2', prompt: 'Look at the footage (detect_footage_mode) and tell me what you would do with it.', tool: { name: 'detect_footage_mode', args: {} } },
      { id: 'review', label: 'Review the edit', icon: 'Eye', prompt: '/review Review the edit and tell me what to fix.' }
    ]
  }
}

/** The one-click actions for a mode, for the AI layout's tool palette. */
export function actionsFor(mode: FootageMode): FootageAction[] {
  return FOOTAGE_MODES[mode].actions
}
