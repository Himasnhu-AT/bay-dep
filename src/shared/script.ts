/**
 * The Script surface: a timeline as a markdown document an agent reads, edits and hands back.
 *
 * An edit that touches twenty clips is twenty tool calls through the rest of the surface — each
 * one an id to copy, a frame to compute and a result to read — and a model that has to hold the
 * whole cut in its head between calls is a model that drifts. Here the cut *is* the document:
 * one line per clip, in timeline order, and the agent edits the text the way a person edits a
 * paper edit. bay diffs what comes back against the timeline and applies the difference as one
 * undo step.
 *
 *     # Script · Interview
 *
 *     timeline: tl_mf3k2a
 *     rev: 3b1f09ac
 *     fps: 30
 *     ripple: off
 *
 *     ## V1 · video · [trk_mf3k2a1]
 *     - [itm_mf3k2a5x] 00:00:00:00 → 00:00:02:15 · goodall.mp4 · src 12.400s
 *       ~ [trn_mf3k9q] cross-dissolve 30f · itm_mf3k2a5x → itm_mf3k2a7p
 *     - [itm_mf3k2a7p] 00:00:02:15 → 00:00:05:00 · broll.mov · src 0.000s
 *
 *     ## V2 · video · [trk_mf3k2a2]
 *     - [itm_mf3k2b0c] 00:00:01:00 → 00:00:03:00 · text · "Jane Goodall"
 *
 * **What a line means.** `in` is the first frame the clip shows and `out` the first frame after
 * it — half-open, the same convention `remove_range` uses, so `out` of one clip equals `in` of
 * the clip that follows it. Timecodes are `hh:mm:ss:ff` at the timeline's nominal rate; a bare
 * frame number such as `75f` is accepted as well. `src` is the source time, in seconds, that
 * plays at `in`. The quoted string on a text clip is its text, JSON-escaped.
 *
 * **The edits a script can express, and exactly what each does:**
 *
 * - *Delete a line* — the clip is removed and leaves a gap. With `ripple: on` in the header,
 *   later clips **on the same track** whose lines were not otherwise edited slide back by the
 *   length of every deleted clip that ended at or before them. Other tracks do not move, so this
 *   can desynchronise them, and the result says so. (`remove_range` is the sync-safe cut.)
 * - *Reorder lines within a track* — the track is resequenced: its surviving clips are laid end
 *   to end in the new order, starting where the track's earliest clip started, each keeping its
 *   length. Gaps on that track close. Timecodes on a reordered track are therefore derived, not
 *   read, so changing one in the same submission is refused rather than half-honoured.
 * - *Change `in` / `out`* — with `src` untouched: both moved by the same amount is a **move**;
 *   only `in` moved is a **head trim**, and the source point advances with it, so the frame at
 *   `out` does not change; only `out` moved is a **tail trim**. Both moved by different amounts
 *   is ambiguous — a move plus a trim, but which? — and is refused unless `src` is also given.
 * - *Change `src`* — the line is then read literally: the clip spans `in`→`out` and plays the
 *   source from `src`. This is a slip, or any trim written out in full.
 * - *Change the quoted text of a text clip* — the words change. If that text asset also backs
 *   another clip, this clip gets its own copy, so editing one line never rewrites a second.
 * - *Delete a `~` transition line* — the transition is removed and the cut is straight again.
 *
 * **Everything else is refused, never guessed**: a line without an id (new clips come from
 * `place_asset`), an id that names nothing, a clip moved into another track's section, a changed
 * source label (the file, or its speed), an edited track header, a missing track section, an
 * edited transition line, or anything on a locked track. Each refusal names the line.
 *
 * **Transitions belong to the junction, and an edit can break the junction.** A transition
 * whose two clips no longer abut after the edit — one was deleted, trimmed away from the other,
 * or reordered apart — is **removed and reported**, not refused. Refusing would make it
 * impossible to reorder any track that carries a dissolve without first deleting it by hand,
 * and keeping it would store a transition `resolveTransition` silently draws nothing for — the
 * same stale-junction rule `rippleDelete` follows. A reorder that brings two *other* clips
 * together creates nothing: a new junction is a straight cut until someone adds a transition.
 *
 * **`rev` is what stops a stale script clobbering the timeline.** It is a hash of the rendered
 * tracks. If the user moves a clip after the agent read the script, the agent's lines still hold
 * the old timecodes, and applying them would silently move the clip back; instead the whole
 * script is refused and the agent is told to read it again.
 *
 * Pure: no store, no window. The renderer's `apply_script` handler parses, diffs, and hands the
 * operations to the store's `applyScript`, which runs `applyScriptOps` inside one `edit()`.
 */

import {
  findAsset,
  findTimeline,
  framesToUs,
  itemEnd,
  textAssetName,
  usToFrames,
  type Asset,
  type Frames,
  type Item,
  type Project,
  type Timeline,
  type Track,
  type Transition
} from './project'
import { shiftKeyframes } from './keyframes'
import { plainTime } from './project'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedClip {
  /** 1-based line number in the submitted text. */
  line: number
  /** The id as written — a full id or an unambiguous prefix. */
  ref: string
  inFrame: Frames
  outFrame: Frames
  /** Everything between the timecodes and `src`/text, compared verbatim with the render. */
  label: string
  /** The `src` token exactly as written, or null when the line has none. */
  srcToken: string | null
  /** The text of a text clip, unescaped, or null when the line carries none. */
  text: string | null
}

export interface ParsedTrack {
  line: number
  ref: string
  /** The whole header line, compared verbatim with the render. */
  header: string
  clips: ParsedClip[]
}

export interface ParsedTransition {
  line: number
  ref: string
  /** Everything after `[id]`, compared verbatim with the render. */
  body: string
}

export interface ParsedScript {
  timelineId: string
  rev: string
  fps: string
  ripple: boolean
  tracks: ParsedTrack[]
  transitions: ParsedTransition[]
}

/** Why a retime happened, in the words the summary uses. */
export type RetimeKind = 'move' | 'head trim' | 'tail trim' | 'trim' | 'slip' | 'reorder' | 'ripple'

export type ScriptOp =
  | { op: 'delete'; itemId: string; summary: string }
  | {
      op: 'retime'
      itemId: string
      /** The line of the clip it retimes — for a ripple or reorder, the clip that moved as a result. */
      line: number | null
      kind: RetimeKind
      from: Frames
      durationInFrames: Frames
      sourceStartUs: number
      summary: string
    }
  | { op: 'setText'; itemId: string; line: number; text: string; summary: string }
  | { op: 'removeTransition'; transitionId: string; line: number | null; summary: string }

export interface ScriptDiff {
  operations: ScriptOp[]
  /** Things the caller must be told that are not themselves operations — desync, mostly. */
  notes: string[]
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ARROW = '→'
const SEP = ' · '

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The nominal rate timecode counts in — the same rounding `formatTimecode` uses. */
function nominal(fps: number): number {
  return fps > 0 ? Math.max(1, Math.round(fps)) : 30
}

/** `hh:mm:ss:ff`. Exact both ways at the nominal rate, which is what makes round trips safe. */
export function scriptTimecode(frames: Frames, fps: number): string {
  const rate = nominal(fps)
  const total = Math.max(0, Math.floor(frames))
  const seconds = Math.floor(total / rate)
  return (
    `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}:` +
    `${pad2(seconds % 60)}:${pad2(total % rate)}`
  )
}

/** Parses `hh:mm:ss:ff`, `mm:ss:ff` or `123f`. Returns a reason when it cannot. */
export function parseScriptTimecode(token: string, fps: number): Frames | string {
  const bare = /^(\d+)f$/.exec(token)
  if (bare) return Number(bare[1])
  const parts = token.split(':')
  if (parts.length < 3 || parts.length > 4 || parts.some((p) => !/^\d+$/.test(p))) {
    return `"${token}" is not a timecode — write hh:mm:ss:ff, or a frame number such as 75f`
  }
  const [h, m, s, f] = (parts.length === 4 ? parts : ['0', ...parts]).map(Number) as [
    number,
    number,
    number,
    number
  ]
  const rate = nominal(fps)
  if (f >= rate) {
    return `"${token}" has frame ${f}, but at ${fps} fps frames run 00–${pad2(rate - 1)}`
  }
  if (m >= 60 || s >= 60) return `"${token}" has minutes or seconds of 60 or more`
  return ((h * 3600 + m * 60 + s) * rate) + f
}

/** Shortest prefix of `id`, at least `min` long, that no other id in `all` shares. */
function shortId(id: string, all: readonly string[], min = 8): string {
  for (let length = Math.min(min, id.length); length < id.length; length += 1) {
    const prefix = id.slice(0, length)
    if (!all.some((other) => other !== id && other.startsWith(prefix))) return prefix
  }
  return id
}

/** A source is anything with a duration to read into. Stills and text have none. */
function hasSource(asset: Asset | undefined): asset is Asset {
  return !!asset && asset.durationUs > 0
}

function isText(asset: Asset | undefined): boolean {
  return asset?.kind === 'text'
}

/**
 * What stands for the clip's source on its line. Text clips say `text` rather than their asset
 * name, because the name is derived from the words — and a label that changes when the text is
 * edited would make every text edit look like a changed source.
 */
function labelFor(asset: Asset | undefined, item: Item): string {
  const base = !asset ? '(missing asset)' : isText(asset) ? 'text' : asset.name.replace(/\s+/g, ' ').trim()
  return item.speed !== 1 ? `${base} @${item.speed}x` : base
}

function srcToken(item: Item): string {
  return `${(item.sourceStartUs / 1_000_000).toFixed(3)}s`
}

function trackHeader(track: Track): string {
  const flags = [track.kind, ...(track.locked ? ['locked'] : [])]
  return `## ${track.name}${SEP}${flags.join(SEP)}${SEP}[${track.id}]`
}

interface Rendering {
  /** Everything below the header — the part `rev` covers. */
  body: string
  itemShort: Map<string, string>
  transitionShort: Map<string, string>
  clipLine: Map<string, string>
  transitionBody: Map<string, string>
}

function renderBody(project: Project, timeline: Timeline): Rendering {
  const items = timeline.tracks.flatMap((t) => t.items)
  const itemIds = items.map((i) => i.id)
  const transitions = timeline.transitions ?? []
  const transitionIds = transitions.map((t) => t.id)
  const itemShort = new Map(itemIds.map((id) => [id, shortId(id, itemIds)]))
  const transitionShort = new Map(transitionIds.map((id) => [id, shortId(id, transitionIds)]))
  const clipLine = new Map<string, string>()
  const transitionBody = new Map<string, string>()

  for (const transition of transitions) {
    const from = itemShort.get(transition.fromItemId) ?? transition.fromItemId
    const to = itemShort.get(transition.toItemId) ?? transition.toItemId
    transitionBody.set(
      transition.id,
      `${transition.kind} ${transition.durationInFrames}f` +
        (transition.direction ? ` ${transition.direction}` : '') +
        `${SEP}${from} ${ARROW} ${to}`
    )
  }

  const lines: string[] = []
  for (const track of timeline.tracks) {
    lines.push(trackHeader(track))
    const ordered = [...track.items].sort((a, b) => a.from - b.from)
    if (ordered.length === 0) lines.push('> (no clips)')
    for (const item of ordered) {
      const asset = findAsset(project, item.assetId)
      const parts = [
        `- [${itemShort.get(item.id)}] ${scriptTimecode(item.from, timeline.fps)} ${ARROW} ` +
          `${scriptTimecode(itemEnd(item), timeline.fps)}`,
        labelFor(asset, item)
      ]
      if (hasSource(asset)) parts.push(`src ${srcToken(item)}`)
      if (isText(asset)) parts.push(JSON.stringify(asset?.text ?? ''))
      const line = parts.join(SEP)
      clipLine.set(item.id, line)
      lines.push(line)
      // Under the outgoing clip, because that is where the eye is when it reaches the cut.
      for (const transition of transitions) {
        if (transition.fromItemId !== item.id) continue
        lines.push(`  ~ [${transitionShort.get(transition.id)}] ${transitionBody.get(transition.id)}`)
      }
    }
    lines.push('')
  }
  // A transition whose outgoing clip is on no track still has to be deletable by line.
  for (const transition of transitions) {
    if (items.some((i) => i.id === transition.fromItemId)) continue
    lines.push(`~ [${transitionShort.get(transition.id)}] ${transitionBody.get(transition.id)}`)
  }

  return { body: lines.join('\n'), itemShort, transitionShort, clipLine, transitionBody }
}

/** FNV-1a, 32-bit. A fingerprint for staleness, not a security boundary. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function revOf(timeline: Timeline, body: string): string {
  return fingerprint(`${timeline.id}\n${timeline.fps}\n${body}`)
}

const GUIDE = [
  '> One line per clip: `- [id] in → out · source · src <seconds>s · "text"`. `in` is the first',
  '> frame shown, `out` the first frame after it (hh:mm:ss:ff at the nominal rate, or `75f`).',
  '> Delete a line to remove a clip (`ripple: on` closes the gap on that track). Reorder lines',
  '> within a track to resequence it end to end. Change in/out to move or trim; change src to',
  '> slip. Edit the quoted text of a text clip. Delete a `~` line to remove a transition.',
  '> Nothing else is accepted — no new lines, no moves between tracks. Keep the header as is.'
].join('\n')

/** The timeline as a script. Deterministic: the same timeline always renders the same text. */
export function renderScript(project: Project, timelineId: string): string {
  const timeline = findTimeline(project, timelineId)
  if (!timeline) return `# Script\n\n> There is no timeline ${timelineId} in this project.\n`
  const { body } = renderBody(project, timeline)
  return [
    `# Script${SEP}${timeline.name}`,
    '',
    `timeline: ${timeline.id}`,
    `rev: ${revOf(timeline, body)}`,
    `fps: ${timeline.fps}`,
    'ripple: off',
    '',
    GUIDE,
    '',
    body
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const CLIP = /^-\s+\[([^\]\s]+)\]\s+(\S+)\s+(?:→|->)\s+(\S+)\s+·\s+(.*)$/
const TRANSITION = /^~\s+\[([^\]\s]+)\]\s+(.*)$/
const SECTION = /^##\s+.*\[([^\]\s]+)\]\s*$/
const HEADER = /^([a-z]+):\s*(.*)$/
const SRC = /^(.*?)\s+·\s+src\s+(\S+)$/

const ALLOWED =
  'A script holds only the header (timeline, rev, fps, ripple), `## track` headers, `- [id]` ' +
  'clip lines, `~ [id]` transition lines, `>` notes and blank lines.'

/**
 * Split off a trailing ` · "json string"`. The leftmost separator whose remainder parses as a
 * JSON string wins, so a text containing ` · "` still round-trips.
 */
function splitText(rest: string): { head: string; text: string | null } | { error: string } {
  if (!rest.endsWith('"')) return { head: rest, text: null }
  let at = rest.indexOf(' · "')
  while (at >= 0) {
    try {
      const value: unknown = JSON.parse(rest.slice(at + 3))
      if (typeof value === 'string') return { head: rest.slice(0, at), text: value }
    } catch {
      // Not the start of the string; try the next separator.
    }
    at = rest.indexOf(' · "', at + 1)
  }
  return {
    error:
      'its quoted text is not a valid JSON string — keep the quotes, and escape a quote inside ' +
      'the text as \\" and a line break as \\n'
  }
}

export function parseScript(text: string): ParsedScript | { error: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const header = new Map<string, { value: string; line: number }>()
  const tracks: ParsedTrack[] = []
  const transitions: ParsedTransition[] = []
  const errors: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const n = index + 1
    const raw = lines[index] ?? ''
    const line = raw.trim()
    if (line === '' || line.startsWith('>') || line.startsWith('<!--')) continue
    if (/^-{3,}$/.test(line)) continue // a markdown rule, not a clip
    if (/^#\s/.test(line)) continue // the title; not read

    if (line.startsWith('##')) {
      const section = SECTION.exec(line)
      if (!section) {
        errors.push(
          `Line ${n}: a track header must end with its id in brackets, like the one read_script ` +
            `rendered — "${line}" has none. Track headers cannot be edited.`
        )
        continue
      }
      tracks.push({ line: n, ref: section[1]!, header: line, clips: [] })
      continue
    }

    if (line.startsWith('~')) {
      const match = TRANSITION.exec(line)
      if (!match) {
        errors.push(`Line ${n}: a transition line reads \`~ [id] …\` exactly as rendered; "${line}" does not.`)
        continue
      }
      transitions.push({ line: n, ref: match[1]!, body: match[2]!.trim() })
      continue
    }

    if (line.startsWith('-')) {
      const current = tracks[tracks.length - 1]
      if (!line.includes('[')) {
        errors.push(
          `Line ${n}: "${line}" has no [id], so it would be a new clip. A script cannot add ` +
            `clips — place them with place_asset, then read_script again.`
        )
        continue
      }
      const match = CLIP.exec(line)
      if (!match) {
        errors.push(
          `Line ${n}: "${line}" is not in the clip form \`- [id] in → out · source · src <s>s\`. ` +
            `Keep the shape read_script rendered and change only the timecodes, src or quoted text.`
        )
        continue
      }
      if (!current) {
        errors.push(`Line ${n}: a clip line comes before any \`## track\` header, so it belongs to no track.`)
        continue
      }
      // The header states the rate; every timecode below it is read at that rate.
      const fps = Number(header.get('fps')?.value)
      if (!Number.isFinite(fps) || fps <= 0) {
        errors.push(`Line ${n}: clip lines need the \`fps:\` header line above them, as rendered.`)
        continue
      }
      const inFrame = parseScriptTimecode(match[2]!, fps)
      const outFrame = parseScriptTimecode(match[3]!, fps)
      if (typeof inFrame === 'string' || typeof outFrame === 'string') {
        errors.push(`Line ${n}: ${typeof inFrame === 'string' ? inFrame : outFrame}.`)
        continue
      }
      const split = splitText(match[4]!.trim())
      if ('error' in split) {
        errors.push(`Line ${n}: ${split.error}.`)
        continue
      }
      const src = SRC.exec(split.head)
      current.clips.push({
        line: n,
        ref: match[1]!,
        inFrame,
        outFrame,
        label: (src ? src[1]! : split.head).trim(),
        srcToken: src ? src[2]! : null,
        text: split.text
      })
      continue
    }

    const pair = HEADER.exec(line)
    if (pair && tracks.length === 0) {
      const key = pair[1]!
      if (!['timeline', 'rev', 'fps', 'ripple'].includes(key)) {
        errors.push(`Line ${n}: "${key}:" is not a script header. The header keys are timeline, rev, fps and ripple.`)
        continue
      }
      if (header.has(key)) {
        errors.push(`Line ${n}: "${key}:" appears twice; keep one.`)
        continue
      }
      header.set(key, { value: pair[2]!.trim(), line: n })
      continue
    }

    errors.push(`Line ${n}: "${line}" is not something a script can contain. ${ALLOWED}`)
  }

  for (const key of ['timeline', 'rev', 'fps'] as const) {
    if (!header.get(key)?.value) {
      errors.unshift(
        `The "${key}:" header line is missing. Start from read_script's output and keep its ` +
          `header unchanged — it is how bay knows which timeline, and which version of it, you edited.`
      )
    }
  }

  let ripple = false
  const rippleValue = header.get('ripple')
  if (rippleValue) {
    const value = rippleValue.value.toLowerCase()
    if (value === 'on' || value === 'true' || value === 'yes') ripple = true
    else if (value !== 'off' && value !== 'false' && value !== 'no') {
      errors.push(`Line ${rippleValue.line}: "ripple:" is on or off, not "${rippleValue.value}".`)
    }
  }

  if (errors.length > 0) return { error: errors.join('\n') }
  return {
    timelineId: header.get('timeline')!.value,
    rev: header.get('rev')!.value,
    fps: header.get('fps')!.value,
    ripple,
    tracks,
    transitions
  }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** Resolve a written id against candidates: exact, or a prefix that names exactly one. */
function resolveRef(ref: string, candidates: readonly string[]): string | { error: string } {
  if (candidates.includes(ref)) return ref
  const matches = candidates.filter((id) => id.startsWith(ref))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) return { error: `[${ref}] matches ${matches.length} ids; use more of it` }
  return { error: `[${ref}] is not an id on this timeline — ids are copied from read_script, never written` }
}

interface Planned {
  item: Item
  track: Track
  line: number | null
  from: Frames
  durationInFrames: Frames
  sourceStartUs: number
  kind: RetimeKind | null
}

const REREAD = 'Call read_script again and make your edit against what it returns.'

export function diffScript(
  project: Project,
  timelineId: string,
  parsed: ParsedScript
): ScriptDiff | { error: string } {
  const timeline = findTimeline(project, timelineId)
  if (!timeline) return { error: `There is no timeline ${timelineId} in this project. ${REREAD}` }
  if (parsed.timelineId !== timeline.id) {
    return {
      error:
        `This script is for timeline ${parsed.timelineId}, but the active timeline is ` +
        `${timeline.id} ("${timeline.name}"). ${REREAD}`
    }
  }
  const rendering = renderBody(project, timeline)
  if (parsed.fps !== String(timeline.fps)) {
    return {
      error:
        `The header says fps: ${parsed.fps}, but this timeline runs at ${timeline.fps}. The frame ` +
        `rate cannot be changed from a script; put the header back as read_script rendered it.`
    }
  }
  if (parsed.rev !== revOf(timeline, rendering.body)) {
    return {
      error:
        `The timeline has changed since this script was read (rev ${parsed.rev} is not the ` +
        `current one), so applying it could undo someone else's edit. ${REREAD}`
    }
  }

  const fps = timeline.fps
  const tc = (frame: Frames): string => scriptTimecode(frame, fps)
  const errors: string[] = []

  // -- tracks --------------------------------------------------------------------------------
  const trackIds = timeline.tracks.map((t) => t.id)
  const seenTracks = new Map<string, ParsedTrack>()
  for (const section of parsed.tracks) {
    const id = resolveRef(section.ref, trackIds)
    if (typeof id !== 'string') {
      errors.push(`Line ${section.line}: ${id.error}. Tracks: ${timeline.tracks.map((t) => `${t.name} [${t.id}]`).join(', ')}.`)
      continue
    }
    if (seenTracks.has(id)) {
      errors.push(`Line ${section.line}: track [${id}] already has a section at line ${seenTracks.get(id)!.line}. Keep one.`)
      continue
    }
    const track = timeline.tracks.find((t) => t.id === id)!
    if (section.header !== trackHeader(track)) {
      errors.push(
        `Line ${section.line}: the header for ${track.name} was edited. Track headers cannot be ` +
          `changed from a script — restore it to \`${trackHeader(track)}\`.`
      )
    }
    seenTracks.set(id, section)
  }
  const missing = timeline.tracks.filter((t) => !seenTracks.has(t.id))
  if (missing.length > 0) {
    // The guard against a partial script: omitting a whole section would otherwise read as
    // "delete every clip on it", which is almost never what a script with one track in it meant.
    errors.push(
      `The script has no section for ${missing.map((t) => `${t.name} [${t.id}]`).join(', ')}. Every ` +
        `track must stay in the script; to empty one, keep its \`##\` header and delete its lines.`
    )
  }
  const sectionOrder = parsed.tracks
    .map((s) => resolveRef(s.ref, trackIds))
    .filter((id): id is string => typeof id === 'string')
  if (missing.length === 0 && errors.length === 0 && sectionOrder.join() !== trackIds.join()) {
    errors.push(
      `The track sections are in a different order from the timeline's tracks ` +
        `(${timeline.tracks.map((t) => t.name).join(', ')}). Track order is stacking order and ` +
        `cannot be changed from a script; put the sections back.`
    )
  }
  if (errors.length > 0) return { error: errors.join('\n') }

  // -- clip lines ----------------------------------------------------------------------------
  const allIds = timeline.tracks.flatMap((t) => t.items.map((i) => i.id))
  const lineFor = new Map<string, { clip: ParsedClip; section: ParsedTrack }>()
  for (const section of parsed.tracks) {
    for (const clip of section.clips) {
      const id = resolveRef(clip.ref, allIds)
      if (typeof id !== 'string') {
        errors.push(`Line ${clip.line}: ${id.error}.`)
        continue
      }
      const earlier = lineFor.get(id)
      if (earlier) {
        errors.push(
          `Line ${clip.line}: clip [${clip.ref}] already appears at line ${earlier.clip.line}. A clip ` +
            `is one line; duplicating one is not supported — use split_at or place_asset.`
        )
        continue
      }
      lineFor.set(id, { clip, section })
    }
  }

  const transitionIds = (timeline.transitions ?? []).map((t) => t.id)
  const keptTransitions = new Map<string, ParsedTransition>()
  for (const written of parsed.transitions) {
    const id = resolveRef(written.ref, transitionIds)
    if (typeof id !== 'string') {
      errors.push(`Line ${written.line}: ${id.error.replace('ids on this timeline', 'transition ids')}. Transitions cannot be added from a script — use add_transition.`)
      continue
    }
    if (keptTransitions.has(id)) {
      errors.push(`Line ${written.line}: transition [${written.ref}] appears twice.`)
      continue
    }
    if (written.body !== rendering.transitionBody.get(id)) {
      errors.push(
        `Line ${written.line}: transition lines can be kept or deleted, not edited — restore it ` +
          `to \`${rendering.transitionBody.get(id)}\`, or use add_transition to change its kind or length.`
      )
      continue
    }
    keptTransitions.set(id, written)
  }
  if (errors.length > 0) return { error: errors.join('\n') }

  // -- per clip: what the line asks for -------------------------------------------------------
  const operations: ScriptOp[] = []
  const notes: string[] = []
  const planned = new Map<string, Planned>()
  const deleted: { item: Item; track: Track }[] = []
  const textChanges: { item: Item; line: number; text: string; before: string }[] = []

  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const written = lineFor.get(item.id)
      if (!written) {
        if (track.locked) {
          errors.push(
            `${track.name} is locked, so its clip [${rendering.itemShort.get(item.id)}] cannot be ` +
              `deleted. Restore the line \`${rendering.clipLine.get(item.id)}\`, or unlock ${track.name} in the UI.`
          )
        }
        deleted.push({ item, track })
        continue
      }
      const { clip, section } = written
      const where = `Line ${clip.line}`
      const sectionTrack = resolveRef(section.ref, trackIds)
      if (sectionTrack !== track.id) {
        const other = timeline.tracks.find((t) => t.id === sectionTrack)
        errors.push(
          `${where}: clip [${clip.ref}] is on ${track.name} but was written under ${other?.name ?? 'another track'}. ` +
            `Moving a clip between tracks is not supported here — use edit_item with trackId.`
        )
        continue
      }
      const asset = findAsset(project, item.assetId)
      const label = labelFor(asset, item)
      if (clip.label !== label) {
        errors.push(
          `${where}: the source "${label}" was changed to "${clip.label}". A script cannot change ` +
            `which file a clip plays or its speed — restore it, or use place_asset / edit_item.`
        )
        continue
      }

      // Text.
      if (isText(asset)) {
        if (clip.text === null) {
          errors.push(`${where}: this is a text clip and its quoted text is gone. Edit inside the quotes; delete the whole line to remove the clip.`)
          continue
        }
        if (clip.text !== (asset?.text ?? '')) {
          if (clip.text.trim() === '') {
            errors.push(`${where}: the text cannot be empty. Delete the line to remove the clip.`)
            continue
          }
          textChanges.push({ item, line: clip.line, text: clip.text, before: asset?.text ?? '' })
        }
      } else if (clip.text !== null) {
        errors.push(`${where}: only text clips carry quoted text, and this one plays "${label}". Remove the quoted part.`)
        continue
      }

      // Timing.
      const expectedSrc = hasSource(asset) ? srcToken(item) : null
      if (expectedSrc === null && clip.srcToken !== null) {
        errors.push(`${where}: "${label}" is a still with no source time, so it takes no src. Remove it.`)
        continue
      }
      if (expectedSrc !== null && clip.srcToken === null) {
        errors.push(`${where}: the src token is gone. Keep \`src ${expectedSrc}\` (or change its value to slip the clip).`)
        continue
      }
      const srcChanged = clip.srcToken !== null && clip.srcToken !== expectedSrc
      let sourceStartUs = item.sourceStartUs
      if (srcChanged) {
        const seconds = /^(\d+(?:\.\d+)?)s?$/.exec(clip.srcToken!)
        if (!seconds) {
          errors.push(`${where}: "src ${clip.srcToken}" is not a number of seconds such as \`src 12.400s\`.`)
          continue
        }
        sourceStartUs = Math.round(Number(seconds[1]) * 1_000_000)
      }

      const inDelta = clip.inFrame - item.from
      const outDelta = clip.outFrame - itemEnd(item)
      let kind: RetimeKind | null = null
      if (srcChanged) {
        kind = inDelta === 0 && outDelta === 0 ? 'slip' : 'trim'
      } else if (inDelta !== 0 && outDelta !== 0 && inDelta !== outDelta) {
        errors.push(
          `${where}: in moved by ${inDelta} frames and out by ${outDelta}, which is a move and a ` +
            `trim at once, and it is not clear which source frame should play at the new in. Also ` +
            `change src to say so, or make the move and the trim in two submissions.`
        )
        continue
      } else if (inDelta !== 0 && outDelta === inDelta) {
        kind = 'move'
      } else if (inDelta !== 0) {
        kind = 'head trim'
        // The source point advances with the in point, so the out frame keeps its picture.
        sourceStartUs = item.sourceStartUs + Math.round(framesToUs(inDelta, fps) * item.speed)
      } else if (outDelta !== 0) {
        kind = 'tail trim'
      }

      if (kind !== null && kind !== 'move' && !plainTime(item)) {
        // `src` is where the clip starts reading — for a reversed clip the late edge of its footage,
        // and under a ramp the frames between do not divide evenly — so the arithmetic below, which
        // is a forward clip's, would trim the wrong footage.
        errors.push(
          `${where}: "${label}" is ${item.reverse ? 'reversed' : 'on a speed ramp'}, so the script can move it but not ${kind} it. ` +
            `Restore its in, out and src, and use trim_item (edge start/end, or mode slip) on ${item.id} instead.`
        )
        continue
      }
      if (kind !== null) {
        if (track.locked) {
          errors.push(`${where}: ${track.name} is locked, so this clip cannot be retimed. Restore the line, or unlock ${track.name} in the UI.`)
          continue
        }
        if (clip.inFrame < 0 || clip.outFrame <= clip.inFrame) {
          errors.push(`${where}: out (${clip.outFrame}f) must come after in (${clip.inFrame}f); a clip is at least one frame.`)
          continue
        }
        if (sourceStartUs < 0) {
          const room = Math.floor(usToFrames(item.sourceStartUs, fps) / (item.speed || 1))
          errors.push(
            `${where}: that head trim reaches before the start of "${label}" — the in point can come ` +
              `back at most ${room} frames, to ${tc(item.from - room)}.`
          )
          continue
        }
        if (hasSource(asset)) {
          const duration = clip.outFrame - clip.inFrame
          const consumed = framesToUs(duration, fps) * item.speed
          const slack = framesToUs(1, fps) / 2
          if (sourceStartUs + consumed > asset.durationUs + slack) {
            const most = Math.max(0, Math.floor(usToFrames(asset.durationUs - sourceStartUs, fps) / item.speed))
            errors.push(
              `${where}: "${label}" runs out of footage — from src ${(sourceStartUs / 1e6).toFixed(3)}s ` +
                `it has ${most} frames, so out can be at most ${tc(clip.inFrame + most)}.`
            )
            continue
          }
        }
      }

      planned.set(item.id, {
        item,
        track,
        line: clip.line,
        from: clip.inFrame,
        durationInFrames: clip.outFrame - clip.inFrame,
        sourceStartUs,
        kind
      })
    }
  }
  for (const change of textChanges) {
    const track = timeline.tracks.find((t) => t.id === change.item.trackId)
    if (track?.locked) {
      errors.push(`Line ${change.line}: ${track.name} is locked, so this clip's text cannot be changed. Unlock it in the UI.`)
    }
  }
  if (errors.length > 0) return { error: errors.join('\n') }

  // -- reorder and ripple, per track -----------------------------------------------------------
  for (const track of timeline.tracks) {
    const section = seenTracks.get(track.id)!
    const writtenOrder = section.clips
      .map((c) => resolveRef(c.ref, allIds))
      .filter((id): id is string => typeof id === 'string' && planned.has(id))
    const currentOrder = [...track.items]
      .sort((a, b) => a.from - b.from)
      .map((i) => i.id)
      .filter((id) => planned.has(id))
    const reordered = writtenOrder.join() !== currentOrder.join()

    if (reordered) {
      if (track.locked) {
        errors.push(`${track.name} is locked, so its clips cannot be reordered. Restore their order, or unlock it in the UI.`)
        continue
      }
      const retimed = writtenOrder.map((id) => planned.get(id)!).filter((p) => p.kind !== null && p.kind !== 'slip')
      if (retimed.length > 0) {
        errors.push(
          `${track.name}: the clips were reordered and line ${retimed.map((p) => p.line).join(', ')} ` +
            `also changed in/out. On a reordered track positions are derived from the order, so ` +
            `timecodes there are not read — reorder in one submission and retime in the next.`
        )
        continue
      }
      // End to end in the written order, from where the track's first surviving clip began.
      let cursor = Math.min(...writtenOrder.map((id) => planned.get(id)!.item.from))
      for (const id of writtenOrder) {
        const plan = planned.get(id)!
        if (plan.from !== cursor) {
          plan.from = cursor
          plan.kind = 'reorder'
        }
        cursor += plan.durationInFrames
      }
      continue
    }

    if (!parsed.ripple) continue
    const removedHere = deleted.filter((d) => d.track.id === track.id).map((d) => d.item)
    if (removedHere.length === 0) continue
    for (const id of currentOrder) {
      const plan = planned.get(id)!
      // Only lines the agent left alone follow the ripple; an edited line says where it goes.
      if (plan.kind !== null && plan.kind !== 'slip') continue
      const shift = removedHere
        .filter((r) => itemEnd(r) <= plan.item.from)
        .reduce((total, r) => total + r.durationInFrames, 0)
      if (shift > 0) {
        plan.from -= shift
        plan.kind = 'ripple'
      }
    }
  }
  if (errors.length > 0) return { error: errors.join('\n') }

  if (parsed.ripple && deleted.length > 0) {
    const rippled = new Set(deleted.map((d) => d.track.id))
    const untouched = timeline.tracks.filter((t) => !rippled.has(t.id) && t.items.length > 0)
    if (untouched.length > 0) {
      notes.push(
        `Ripple closed gaps on ${timeline.tracks.filter((t) => rippled.has(t.id)).map((t) => t.name).join(', ')} ` +
          `only. ${untouched.map((t) => t.name).join(', ')} did not move, so anything there that ` +
          `was in sync with a later clip is now early. Use remove_range when sync matters.`
      )
    }
  }

  // -- the result must be a legal timeline -----------------------------------------------------
  for (const track of timeline.tracks) {
    const onTrack = [...planned.values()]
      .filter((p) => p.track.id === track.id)
      .sort((a, b) => a.from - b.from)
    for (let i = 1; i < onTrack.length; i += 1) {
      const a = onTrack[i - 1]!
      const b = onTrack[i]!
      if (a.from + a.durationInFrames > b.from) {
        const name = (p: Planned): string =>
          p.line !== null ? `line ${p.line} [${rendering.itemShort.get(p.item.id)}]` : `[${rendering.itemShort.get(p.item.id)}]`
        errors.push(
          `${track.name}: ${name(a)} would run ${tc(a.from)} → ${tc(a.from + a.durationInFrames)} and ` +
            `overlap ${name(b)} at ${tc(b.from)} → ${tc(b.from + b.durationInFrames)}. Two clips on ` +
            `one track cannot overlap — end the first by ${tc(b.from)}, or start the second at ` +
            `${tc(a.from + a.durationInFrames)} or later.`
        )
      }
    }
  }
  if (errors.length > 0) return { error: errors.join('\n') }

  // -- operations --------------------------------------------------------------------------------
  for (const { item, track } of deleted) {
    const line = rendering.clipLine.get(item.id) ?? ''
    operations.push({
      op: 'delete',
      itemId: item.id,
      summary: `Deleted from ${track.name}: ${line.replace(/^- /, '')}`
    })
  }
  for (const plan of planned.values()) {
    if (plan.kind === null) continue
    const moved = plan.from !== plan.item.from || plan.durationInFrames !== plan.item.durationInFrames
    if (!moved && plan.sourceStartUs === plan.item.sourceStartUs) continue
    const short = rendering.itemShort.get(plan.item.id)
    operations.push({
      op: 'retime',
      itemId: plan.item.id,
      line: plan.line,
      kind: plan.kind,
      from: plan.from,
      durationInFrames: plan.durationInFrames,
      sourceStartUs: plan.sourceStartUs,
      summary:
        `${plan.kind[0]!.toUpperCase()}${plan.kind.slice(1)} [${short}] on ${plan.track.name}: ` +
        `${tc(plan.item.from)} ${ARROW} ${tc(itemEnd(plan.item))} is now ` +
        `${tc(plan.from)} ${ARROW} ${tc(plan.from + plan.durationInFrames)}` +
        (plan.sourceStartUs !== plan.item.sourceStartUs
          ? `, reading from ${(plan.sourceStartUs / 1e6).toFixed(3)}s`
          : '') +
        '.'
    })
  }
  for (const change of textChanges) {
    operations.push({
      op: 'setText',
      itemId: change.item.id,
      line: change.line,
      text: change.text,
      summary: `Text of [${rendering.itemShort.get(change.item.id)}]: ${JSON.stringify(change.before)} is now ${JSON.stringify(change.text)}.`
    })
  }

  // Transitions: deleted lines are removals; junctions the edit broke are removed and reported.
  const gone = new Set(deleted.map((d) => d.item.id))
  for (const transition of timeline.transitions ?? []) {
    const short = rendering.transitionShort.get(transition.id)
    const what = `${transition.kind} [${short}]`
    if (!keptTransitions.has(transition.id)) {
      operations.push({
        op: 'removeTransition',
        transitionId: transition.id,
        line: null,
        summary: `Removed ${what}: its line was deleted, so that cut is straight again.`
      })
      continue
    }
    const broken = brokenJunction(transition, planned, gone, rendering, tc)
    if (broken) {
      operations.push({
        op: 'removeTransition',
        transitionId: transition.id,
        line: keptTransitions.get(transition.id)!.line,
        summary: `Removed ${what}: ${broken}. Add a new one with add_transition if the new cut wants one.`
      })
    }
  }

  return { operations, notes }
}

/** Why a transition no longer has a cut to sit on after the planned edit, or null if it does. */
function brokenJunction(
  transition: Transition,
  planned: Map<string, Planned>,
  gone: Set<string>,
  rendering: Rendering,
  tc: (frame: Frames) => string
): string | null {
  const name = (id: string): string => `[${rendering.itemShort.get(id) ?? id}]`
  if (gone.has(transition.fromItemId)) return `${name(transition.fromItemId)}, the clip before the cut, was deleted`
  if (gone.has(transition.toItemId)) return `${name(transition.toItemId)}, the clip after the cut, was deleted`
  const from = planned.get(transition.fromItemId)
  const to = planned.get(transition.toItemId)
  if (!from || !to) return 'one of its clips is no longer on the timeline'
  const end = from.from + from.durationInFrames
  // Only a junction this edit broke is reported. One that was already stale is left for
  // `resolveTransition` to ignore, exactly as before — this is not a cleanup pass.
  const wasAbutting = itemEnd(from.item) === to.item.from && from.track.id === to.track.id
  if (!wasAbutting) return null
  if (end !== to.from) {
    return `${name(transition.fromItemId)} now ends at ${tc(end)} and ${name(transition.toItemId)} starts at ${tc(to.from)}, so they no longer meet`
  }
  return null
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Apply `operations` to `project`, mutating it. Meant to run inside the store's `edit()` on its
 * clone, so the whole script is one history entry.
 *
 * The operations were validated against this exact timeline by `diffScript`, so positions are
 * written directly rather than through `moveItem` — which would refuse an intermediate state in
 * which two clips swapping places briefly overlap, even though the final one is legal.
 */
export function applyScriptOps(
  project: Project,
  timelineId: string,
  operations: readonly ScriptOp[],
  newId: (prefix: string) => string
): void {
  const timeline = findTimeline(project, timelineId)
  if (!timeline) return
  const find = (id: string): { item: Item; track: Track } | undefined => {
    for (const track of timeline.tracks) {
      const item = track.items.find((i) => i.id === id)
      if (item) return { item, track }
    }
    return undefined
  }

  for (const op of operations) {
    if (op.op === 'delete') {
      const found = find(op.itemId)
      if (found) found.track.items = found.track.items.filter((i) => i.id !== op.itemId)
    } else if (op.op === 'removeTransition') {
      if (timeline.transitions) {
        timeline.transitions = timeline.transitions.filter((t) => t.id !== op.transitionId)
      }
    } else if (op.op === 'retime') {
      const found = find(op.itemId)
      if (!found) continue
      const { item } = found
      // A head trim keeps keys on the footage they were on; a move carries them (`@shared/keyframes`).
      if (op.kind === 'head trim' && item.keyframes) {
        item.keyframes = shiftKeyframes(item.keyframes, item.from - op.from)
      }
      item.from = op.from
      item.durationInFrames = op.durationInFrames
      item.sourceStartUs = op.sourceStartUs
      if (item.fadeInFrames > item.durationInFrames) item.fadeInFrames = item.durationInFrames
      if (item.fadeOutFrames > item.durationInFrames) item.fadeOutFrames = item.durationInFrames
    } else if (op.op === 'setText') {
      const found = find(op.itemId)
      if (!found) continue
      const asset = findAsset(project, found.item.assetId)
      if (!asset) continue
      const sharers = project.timelines
        .flatMap((tl) => tl.tracks.flatMap((t) => t.items))
        .filter((i) => i.assetId === asset.id && i.id !== found.item.id)
      if (sharers.length > 0) {
        // The asset backs another clip too. Changing it in place would rewrite that clip's
        // words as well, so this one gets its own copy and the other is left as it was.
        const copy: Asset = { ...asset, id: newId('ast'), text: op.text, name: textAssetName(op.text), createdAt: Date.now() }
        project.assets.push(copy)
        found.item.assetId = copy.id
      } else {
        // A name still derived from the old words follows the new ones; a renamed one stays.
        if (asset.name === textAssetName(asset.text ?? '')) asset.name = textAssetName(op.text)
        asset.text = op.text
      }
    }
  }
  for (const track of timeline.tracks) track.items.sort((a, b) => a.from - b.from)
}

/** Parse and diff in one step — what `apply_script` does before it touches the store. */
export function planScript(
  project: Project,
  timelineId: string,
  text: string
): { diff: ScriptDiff } | { error: string } {
  const parsed = parseScript(text)
  if ('error' in parsed) {
    return { error: `${parsed.error}\nNothing was changed.` }
  }
  const diff = diffScript(project, timelineId, parsed)
  if ('error' in diff) return { error: `${diff.error}\nNothing was changed.` }
  return { diff }
}

/** The operations as the lines a person (or agent) reads back. */
export function summariseScript(diff: ScriptDiff): string[] {
  return [...diff.operations.map((op) => op.summary), ...diff.notes]
}
