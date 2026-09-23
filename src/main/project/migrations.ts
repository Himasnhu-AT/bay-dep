/**
 * How a `.bay` document on disk becomes the `Project` this build works with.
 *
 * Two layers, kept apart on purpose because they answer different questions:
 *
 * - **Migrations** change what a document *means*. One per format version, keyed by the version
 *   it upgrades *from*, each returning a document at exactly the next version. They run in a
 *   chain — a version-0 file walks 0 → 1 → … → `PROJECT_VERSION` — so each step is written once,
 *   against the one shape it knows, and never has to anticipate a later one.
 * - **Transforms** repair what a document *says* without changing the format: a value the
 *   model forbids (a negative start, `null` where a number belongs because `JSON.stringify`
 *   wrote a `NaN` that way), a required field an older writer omitted. They run on every load at
 *   every version, and each must be a no-op on a well-formed document — the version-1 fixture is
 *   the proof, loading field for field unchanged.
 *
 * Mixing the two is how a format rots: a rename smuggled in as "normalisation" is a version
 * change nobody bumped, and every older build that reads the new file silently drops the field.
 *
 * **The policy, and the test that holds it (`migrations.test.ts`):** a schema change inside one
 * version is *additive only*. A new *optional* field needs no migration — an older build of the
 * same version loads the file, carries the unknown key through untouched (nothing here
 * whitelists fields), and writes it back. Renaming, removing or retyping a field needs a bump of
 * `PROJECT_VERSION` **and** a migration registered from the previous version **and** a literal
 * fixture of the old format in `@shared/project-fixtures`. The test fails if any of the three is
 * missing.
 *
 * A document from a *newer* version is refused, never loaded. Loading it would mean guessing at
 * fields this build does not know, and the next save would write the project back without them.
 *
 * Pure — no Electron, no filesystem — so all of it runs under `pnpm test`.
 */

import type { Item, Layout, Project, Timeline, Track } from '@shared/project'
import { PROJECT_VERSION } from '@shared/project'

/** A document as parsed from JSON, before anything vouches for its shape. */
export type RawDocument = Record<string, unknown>

/**
 * `MIGRATIONS[n]` upgrades a version-`n` document to version `n + 1`.
 *
 * There must be one for every version below `PROJECT_VERSION` and none at or above it. A
 * migration receives a document it may mutate (the chain hands it a copy) and must stamp the
 * new `version` itself — the chain checks, because a step that forgot would loop forever.
 */
export const MIGRATIONS: Record<number, (doc: RawDocument) => RawDocument> = {
  // Version-0 files predate the `version` field and are otherwise identical to version 1.
  0: (doc) => ({ ...doc, version: 1 })
}

/** The version a raw document claims; absent means it predates the field, which is 0. */
export function documentVersion(doc: RawDocument): number {
  return doc.version === undefined ? 0 : (doc.version as number)
}

/**
 * Walk a document from its own version up to `PROJECT_VERSION`.
 *
 * Throws, with a sentence meant for the person who tried to open the file, when the document is
 * from a newer bay or claims a version that is not a version at all. A gap in the chain is a
 * fault in this build rather than in the file, and the message says so.
 */
export function runMigrations(doc: RawDocument, fileName: string): RawDocument {
  const claimed = documentVersion(doc)
  if (typeof claimed !== 'number' || !Number.isInteger(claimed) || claimed < 0) {
    throw new Error(
      `${fileName} has a project format version of ${JSON.stringify(doc.version)}, which is not ` +
        `a version bay has ever written. The file may have been edited by hand.`
    )
  }
  if (claimed > PROJECT_VERSION) {
    throw new Error(
      `${fileName} was saved by a newer version of bay (project format ${claimed}, this build ` +
        `reads ${PROJECT_VERSION}). Update bay to open it — this build will not open it, ` +
        `because saving it again would drop whatever the newer format added.`
    )
  }

  let current: RawDocument = structuredClone(doc)
  for (let version = claimed; version < PROJECT_VERSION; version += 1) {
    const step = MIGRATIONS[version]
    if (!step) {
      throw new Error(
        `This build of bay cannot upgrade project format ${version} to ${version + 1}: the ` +
          `migration is missing. That is a fault in bay, not in ${fileName}.`
      )
    }
    current = step(current)
    if (current.version !== version + 1) {
      throw new Error(
        `The migration from project format ${version} produced version ` +
          `${JSON.stringify(current.version)} instead of ${version + 1}. That is a fault in bay.`
      )
    }
  }
  return current
}

// ---------------------------------------------------------------------------
// Transforms — normalisation that is not a version change
// ---------------------------------------------------------------------------

/**
 * One load-time repair. Mutates the project it is given (the loader hands it a clone) and
 * must leave a well-formed project exactly as it found it.
 *
 * Transforms never materialise an *optional* field: absence of `transitions` or `crop` is a
 * statement ("none"), and writing `[]` back into every file on its next save would churn every
 * project on disk for no change in meaning.
 */
export interface Transform {
  name: string
  apply(project: Project): void
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function eachTrack(project: Project, visit: (track: Track, timeline: Timeline) => void): void {
  for (const timeline of project.timelines) {
    for (const track of timeline.tracks ?? []) visit(track, timeline)
  }
}

function eachItem(project: Project, visit: (item: Item, timeline: Timeline) => void): void {
  eachTrack(project, (track, timeline) => {
    for (const item of track.items) visit(item, timeline)
  })
}

export const TRANSFORMS: Transform[] = [
  {
    // Required on every track. A hand-edited file, or a writer that trusted `undefined` to mean
    // "none", leaves them out — and `track.items.filter` on a missing array is a crash on open.
    name: 'track-defaults',
    apply(project) {
      for (const timeline of project.timelines) {
        if (!Array.isArray(timeline.tracks)) timeline.tracks = []
      }
      eachTrack(project, (track) => {
        if (!Array.isArray(track.items)) track.items = []
        if (typeof track.locked !== 'boolean') track.locked = false
        if (typeof track.muted !== 'boolean') track.muted = false
        if (typeof track.hidden !== 'boolean') track.hidden = false
      })
    }
  },
  {
    // The invariants the store's `patchItem` enforces on every edit, enforced on the way in too:
    // a file is only as trustworthy as the least careful thing that wrote it.
    name: 'item-timing',
    apply(project) {
      eachItem(project, (item) => {
        if (!finite(item.from) || item.from < 0) item.from = 0
        if (!finite(item.durationInFrames) || item.durationInFrames < 1) item.durationInFrames = 1
        const duration = item.durationInFrames
        const clampFade = (fade: unknown): number =>
          finite(fade) ? Math.min(Math.max(0, fade), duration) : 0
        item.fadeInFrames = clampFade(item.fadeInFrames)
        item.fadeOutFrames = clampFade(item.fadeOutFrames)
      })
    }
  },
  {
    // `JSON.stringify(NaN)` is `null`, so a NaN that reached the store — the one CLAUDE.md
    // describes arriving through `NumberField` — comes back from disk as `null` in a number
    // field. One `null` in the layout draws the clip nowhere with no error; each field falls
    // back to its identity, the same rule the filter chain uses for adjustments.
    name: 'item-numbers',
    apply(project) {
      eachItem(project, (item, timeline) => {
        if (!finite(item.volume)) item.volume = 1
        else if (item.volume < 0) item.volume = 0
        if (!finite(item.speed) || item.speed <= 0) item.speed = 1
        if (!finite(item.sourceStartUs) || item.sourceStartUs < 0) item.sourceStartUs = 0
        const identity: Pick<Layout, 'left' | 'top' | 'width' | 'height' | 'opacity' | 'rotation'> = {
          left: 0,
          top: 0,
          width: timeline.width,
          height: timeline.height,
          opacity: 1,
          rotation: 0
        }
        const layout = (item.layout ?? {}) as Partial<Layout>
        const repaired = { ...layout } as Layout
        for (const key of Object.keys(identity) as (keyof typeof identity)[]) {
          if (!finite(layout[key])) repaired[key] = identity[key]
        }
        item.layout = repaired
      })
    }
  }
]

export function applyTransforms(project: Project): Project {
  for (const transform of TRANSFORMS) transform.apply(project)
  return project
}
