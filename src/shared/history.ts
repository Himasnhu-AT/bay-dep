/**
 * The undo history as a list a person can read: one line per step, who made it, and where the
 * project stands in it.
 *
 * The store keeps history as snapshots — `past`, the project, `future` — which is one chain of
 * states in order. A *step* is the change between two neighbours in that chain, so a chain of n
 * states has n−1 steps, and "jump to" names a state: position 0 is before every step, position k
 * is after the first k.
 *
 * A step's label is whatever the edit said about itself, and failing that what changed, in the
 * words the Changes card already uses (`describeChanges`). The second is the default on purpose:
 * most of the store's actions were written before steps had names, and a label derived from the
 * two states cannot drift from what the step did.
 */

import { describeChanges } from './diff'
import type { Project } from './project'

/** Who made a step. A client is something on bay's MCP socket; an agent is the in-app one. */
export type StepActor = 'user' | 'agent' | 'client'

/** What an edit can say about the step it makes. Both optional; kept beside the snapshot. */
export interface StepNote {
  actor: StepActor
  label?: string
}

export interface HistoryStep {
  /** The position this step leads to: jumping here leaves this step applied and later ones not. */
  position: number
  label: string
  actor: StepActor
  /** False for a step that has been undone and can be redone. */
  applied: boolean
}

export interface HistoryView {
  /** How many steps are applied — the position the project is at now. */
  position: number
  /** Oldest first. */
  steps: HistoryStep[]
}

/** The label used when an edit named itself nothing and the two states differ in nothing describable. */
export const UNNAMED_STEP = 'Edit'

/** What changed between two states, as one line. */
export function describeStep(before: Project, after: Project): string {
  const lines = describeChanges(before, after)
  const first = lines[0]
  if (!first) return UNNAMED_STEP
  return lines.length === 1 ? first.text : `${first.text}, and ${lines.length - 1} more`
}

/** The actor's name where a step is listed. A user's steps carry none: they are the default. */
export function actorLabel(actor: StepActor): string | null {
  return actor === 'agent' ? 'Agent' : actor === 'client' ? 'MCP client' : null
}

/**
 * The history, from the store's three fields. `noteOf` looks a step up by the state it started
 * from — notes are kept by that snapshot's identity, so they follow it through undo and redo.
 */
export function historyView(
  past: readonly Project[],
  project: Project,
  future: readonly Project[],
  noteOf: (before: Project) => StepNote | undefined,
  describe: (before: Project, after: Project) => string = describeStep
): HistoryView {
  const chain = [...past, project, ...future]
  const steps: HistoryStep[] = []
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const before = chain[i]!
    const note = noteOf(before)
    steps.push({
      position: i + 1,
      label: note?.label ?? describe(before, chain[i + 1]!),
      actor: note?.actor ?? 'user',
      applied: i < past.length
    })
  }
  return { position: past.length, steps }
}

/**
 * How to get from where the project is to `position`: so many undos or redos. A position outside
 * the history is refused with the range that exists, never clamped — "jump to step 40" of a
 * 12-step history landing on step 12 is an answer to a question nobody asked.
 */
export function planJump(
  current: number,
  total: number,
  position: number
): { undo: number; redo: number } | { error: string } {
  if (!Number.isInteger(position) || position < 0 || position > total) {
    return {
      error:
        total === 0
          ? 'There is no history yet — no change has been made to this project.'
          : `There is no step ${position}: the history runs from 0 (before the first change) to ${total}, and the project is at ${current}.`
    }
  }
  return position < current ? { undo: current - position, redo: 0 } : { undo: 0, redo: position - current }
}
