/**
 * Shared machinery for the tool implementations: how they fail, and how they turn the ids
 * an agent gives us into the things those ids name.
 *
 * The house rule for every message in this directory is that it must be **actionable**. An
 * agent does not read an error to understand the system; it reads it to decide what to call
 * next. "Invalid track" ends a turn. "Track V1 is locked — unlock it in the UI or pass a
 * different trackId; V2 is free" starts the next call.
 */

import {
  activeTimeline,
  allItems,
  findAsset,
  itemEnd,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type Track
} from '@shared/project'
import { resolveId } from '@shared/mcp'
import { useEditor, type EditorStore } from '@/store/editor'

/** A failure the dispatcher turns into `{ ok: false, error }`. The message is the product. */
export class ToolError extends Error {
  /**
   * The same refusal for a person, when the inspector runs the tool's executor for them and the
   * agent's wording names ids or argument names (`keyframes.left`). Absent when `message` reads
   * fine to both.
   */
  readonly userMessage: string | undefined
  constructor(message: string, userMessage?: string) {
    super(message)
    this.name = 'ToolError'
    this.userMessage = userMessage
  }
}

/**
 * What the executor hands a handler besides its arguments. Only the tools that wait read it
 * (`./wait.ts`); every other handler ignores the second argument.
 */
export interface CallContext {
  /** Aborted when the caller is gone: its connection closed (a stopped turn), or main gave up. */
  signal: AbortSignal
  /**
   * Runs `work` as time this call is not acting. A tool call counts as the agent's (or a
   * client's) while it runs, so an edit the user makes meanwhile is marked as theirs; a call
   * that sits waiting for an export would otherwise claim the user's edits for 30 seconds.
   */
  idle<T>(work: () => Promise<T>): Promise<T>
}

/** For a handler called directly (a panel, a test): never aborted, and nothing to step aside from. */
export const DIRECT_CALL: CallContext = {
  signal: new AbortController().signal,
  idle: (work) => work()
}

/** One tool's implementation: validated arguments in, the result the agent reads out. */
export type Handler = (args: Record<string, unknown>, context?: CallContext) => unknown | Promise<unknown>

/**
 * A module's tools, by name. Every executor module that implements tools exports one as
 * `handlers`; `registry.ts` is generated from them (`pnpm gen:tools`).
 */
export type Handlers = Record<string, Handler>

export function fail(message: string, userMessage?: string): never {
  throw new ToolError(message, userMessage)
}

export function store(): EditorStore {
  return useEditor.getState()
}

/**
 * The timeline every tool operates on.
 *
 * There is only ever one active timeline and no tool takes a timeline id, because an agent
 * that could address the wrong timeline would edit invisibly — the user is looking at one.
 */
export function timeline(): Timeline {
  const active = activeTimeline(store().project)
  if (!active) {
    fail('This project has no active timeline, so there is nothing to read or edit yet.')
  }
  return active
}

export function project(): Project {
  return store().project
}

export function resolveItem(given: string): { item: Item; track: Track } {
  const tl = timeline()
  const items = allItems(tl)
  const resolved = resolveId(given, items.map((i) => i.id))
  if (!resolved.ok) fail(resolved.error)
  // `resolveId` only ever returns an id out of the list it was handed, so this cannot miss.
  // The check exists because TypeScript cannot know that — it is not catching a runtime case.
  const item = items.find((i) => i.id === resolved.id)
  if (!item) fail(`No item ${resolved.id} on the active timeline.`)
  const track = tl.tracks.find((t) => t.items.some((i) => i.id === item.id))
  if (!track) fail(`Item ${item.id} is not on any track, which should not be possible.`)
  return { item, track }
}

export function resolveTrack(given: string): Track {
  const tl = timeline()
  const resolved = resolveId(given, tl.tracks.map((t) => t.id))
  if (!resolved.ok) {
    // The generic "call read_project" is true but slow. The tracks are a short list and
    // naming them here usually saves the agent that round trip.
    fail(
      `${resolved.error} Tracks on this timeline: ` +
        tl.tracks.map((t) => `${t.name} (${t.kind}, ${t.id})`).join(', ') + '.'
    )
  }
  const track = tl.tracks.find((t) => t.id === resolved.id)
  if (!track) fail(`No track ${given}.`)
  return track
}

export function resolveAsset(given: string): Asset {
  const p = project()
  const resolved = resolveId(given, p.assets.map((a) => a.id))
  if (!resolved.ok) fail(resolved.error)
  const asset = findAsset(p, resolved.id)
  if (!asset) fail(`No asset ${given}.`)
  return asset
}

/**
 * Refuses when `candidate` would overlap something already on `track`.
 *
 * The store's `moveItem` checks this too and then silently does nothing, which would reach
 * the agent as a successful call that changed nothing — the exact shape of failure this
 * project keeps finding. Checking here means the refusal can say what is in the way.
 */
export function assertNoCollision(
  track: Track,
  candidate: { id: string; from: number; durationInFrames: number }
): void {
  const end = candidate.from + candidate.durationInFrames
  const clash = track.items.find(
    (other) => other.id !== candidate.id && other.from < end && candidate.from < itemEnd(other)
  )
  if (!clash) return
  fail(
    `Frames ${candidate.from}-${end} on track ${track.name} are occupied by item ${clash.id} ` +
      `(${clash.from}-${itemEnd(clash)}). Move that item first, pick a different trackId, or ` +
      `place this one outside that range.`
  )
}

export function assertUnlocked(track: Track, what: string): void {
  if (!track.locked) return
  const free = timeline().tracks.filter((t) => !t.locked && t.kind === track.kind)
  fail(
    `Track ${track.name} is locked, so ${what} is refused. Unlock it in the UI, or pass a ` +
      `different trackId` +
      (free.length > 0 ? `: ${free.map((t) => `${t.name} (${t.id})`).join(', ')}.` : '.')
  )
}

/** Microseconds to frames at the active timeline's rate, which is the only rate an agent sees. */
export function usToFramesAtTimeline(micros: number): number {
  const fps = timeline().fps || 30
  return Math.max(0, Math.round((micros / 1_000_000) * fps))
}
