/**
 * What each undo step said about itself, kept beside the snapshots rather than in them.
 *
 * `past` and `future` are arrays of projects, and a dozen places build them: `edit()`, the three
 * ways a transaction closes, a revert, a probe putting the stack back. A parallel array of labels
 * would have to be kept in step by every one of them, and the first to forget would mislabel
 * every step after it. So a note is keyed by the snapshot the step started from — the object
 * itself, which the store never copies when it moves between `past` and `future` — and a step
 * with no note is described from its two states (`@shared/history`). Nothing can fall out of
 * step, and a snapshot that leaves the history takes its note with it.
 */

import type { Project } from '@shared/project'
import type { StepNote } from '@shared/history'
import { agentActingDepth, clientActingDepth } from './agent-turns'

const notes = new WeakMap<Project, StepNote>()

/** Who is editing right now: an agent's or a client's tool call is running, or it is the user. */
export function actorNow(): StepNote['actor'] {
  if (agentActingDepth() > 0) return 'agent'
  if (clientActingDepth() > 0) return 'client'
  return 'user'
}

/** Record the step that starts from `before`. A new step from the same state replaces the old. */
export function noteStep(before: Project, label?: string): void {
  notes.set(before, label === undefined ? { actor: actorNow() } : { actor: actorNow(), label })
}

export const stepNote = (before: Project): StepNote | undefined => notes.get(before)

/** A snapshot was replaced by a copy (Save As restamps every one): its note goes with it. */
export function carryNote(from: Project, to: Project): void {
  const note = notes.get(from)
  if (note) notes.set(to, note)
}
