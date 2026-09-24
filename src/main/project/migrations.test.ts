/**
 * The `.bay` format policy, as tests: *additive only within a version; anything else is a bump,
 * a migration and a fixture.*
 *
 * What each test would catch if the policy were broken:
 *
 * - `PROJECT_VERSION` bumped with no migration from the previous version → the registry test.
 * - A migration registered at or past the current version (written, but the bump forgotten) →
 *   the registry test, from the other side.
 * - A version bumped without a literal document of the new format → the fixture-coverage test.
 * - The loader starting to whitelist fields, so a newer build's optional field is dropped by an
 *   older build of the same version → the unknown-fields test.
 * - A transform that rewrites a well-formed document (i.e. a format change dressed up as a
 *   repair) → the fixture loading "unchanged in meaning".
 *
 * Mutation-tested; see the commit that introduced this file for the runs.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/project/migrations.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_VERSION, type Project } from '@shared/project'
import { BAY_DOCUMENTS, V1_ON_DISK } from '@shared/project-fixtures'
import { MIGRATIONS, TRANSFORMS, applyTransforms, runMigrations } from './migrations'
import { migrate } from './persistence'

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('every version below the current one has a migration, and none at or above it', () => {
  // Derived from the constant rather than pinned to 1, so a bump fails here — naming the missing
  // migration — instead of at an assertion that only says the number changed.
  assert.ok(PROJECT_VERSION >= 1, 'the format has been versioned since version 1')
  for (let version = 0; version < PROJECT_VERSION; version += 1) {
    assert.equal(
      typeof MIGRATIONS[version],
      'function',
      `PROJECT_VERSION is ${PROJECT_VERSION}, but there is no migration from format ${version}. ` +
        `Renaming, removing or retyping a field needs a migration registered from the previous ` +
        `version in src/main/project/migrations.ts — or, if the change was additive, no bump.`
    )
  }
  const stray = Object.keys(MIGRATIONS)
    .map(Number)
    .filter((from) => from >= PROJECT_VERSION)
  assert.deepEqual(
    stray,
    [],
    `migrations registered from format ${stray.join(', ')}, which is not below PROJECT_VERSION ` +
      `(${PROJECT_VERSION}) — was the migration written and the bump forgotten?`
  )
})

test('every format version from 0 to the current one has a literal document on disk to load', () => {
  for (let version = 0; version <= PROJECT_VERSION; version += 1) {
    assert.equal(
      typeof BAY_DOCUMENTS[version],
      'string',
      `There is no fixture for project format ${version} in src/shared/project-fixtures.ts. ` +
        `A new format needs its document spelled out there, key by key, before files in it exist.`
    )
  }
})

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

test('every fixture, from every version, loads through the chain to the current version', () => {
  for (const [version, text] of Object.entries(BAY_DOCUMENTS)) {
    const loaded = migrate(parse(text), `/fixtures/v${version}.bay`)
    assert.equal(loaded.version, PROJECT_VERSION, `format ${version} did not reach the current version`)
    // The ids are the fixture's own; a migration that rebuilt the document from scratch would
    // mint new ones.
    assert.equal(loaded.id, parse(text).id)
    assert.ok(loaded.timelines.length > 0)
  }
})

test('the version-1 document loads unchanged in meaning — no transform touches a well-formed file', () => {
  const onDisk = parse(V1_ON_DISK)
  const loaded = migrate(onDisk, '/fixtures/existing.bay') as unknown as Record<string, unknown>
  // Everything the file said, and exactly one thing it did not: where it was read from.
  assert.deepEqual(loaded, { ...onDisk, filePath: '/fixtures/existing.bay' })
})

test('a version-0 document is its version-1 self with the version stamped', () => {
  const onDisk = parse(BAY_DOCUMENTS[0]!)
  assert.equal('version' in onDisk, false, 'the v0 fixture must actually lack the field')
  const loaded = migrate(onDisk, '/fixtures/old.bay') as unknown as Record<string, unknown>
  assert.deepEqual(loaded, { ...onDisk, version: 1, filePath: '/fixtures/old.bay' })
})

test('fields this build does not know survive the load, at every depth', () => {
  // Additive-only is only safe if an older build of the same version carries a newer build's
  // optional field through untouched: it loads, it saves, and the field is still there. A loader
  // that whitelisted fields would make every additive change a silent data loss on round trip.
  const onDisk = parse(V1_ON_DISK) as unknown as Project & Record<string, unknown>
  onDisk.futureTopLevel = { kept: true }
  const item = onDisk.timelines[0]!.tracks[0]!.items[0]! as unknown as Record<string, unknown>
  item.futureItemField = 'kept'

  const loaded = migrate(onDisk, '/fixtures/newer-optional.bay') as unknown as Record<string, unknown>
  assert.deepEqual(loaded.futureTopLevel, { kept: true })
  const loadedItem = (loaded as unknown as Project).timelines[0]!.tracks[0]!.items[0] as unknown as Record<
    string,
    unknown
  >
  assert.equal(loadedItem.futureItemField, 'kept')
})

test('a document from a newer format is refused, naming both versions and what to do', () => {
  const newer = { ...parse(V1_ON_DISK), version: PROJECT_VERSION + 1 }
  assert.throws(
    () => migrate(newer, '/x/from-the-future.bay'),
    (error: Error) =>
      error.message.includes('from-the-future.bay') &&
      error.message.includes(`project format ${PROJECT_VERSION + 1}`) &&
      error.message.includes(`this build reads ${PROJECT_VERSION}`) &&
      /Update bay/.test(error.message)
  )
  // Positive control: the same document at the current version opens.
  assert.equal(migrate(parse(V1_ON_DISK), '/x/current.bay').version, PROJECT_VERSION)
})

test('a version that is not a version is refused rather than treated as 0', () => {
  for (const bad of ['1', 1.5, -1, null]) {
    assert.throws(
      () => runMigrations({ ...parse(V1_ON_DISK), version: bad }, 'odd.bay'),
      /not a version bay has ever written/,
      `version ${JSON.stringify(bad)} was accepted`
    )
  }
})

test('the chain does not mutate the document it was handed', () => {
  const onDisk = parse(BAY_DOCUMENTS[0]!)
  const snapshot = JSON.stringify(onDisk)
  runMigrations(onDisk, 'old.bay')
  assert.equal(JSON.stringify(onDisk), snapshot)
})

// ---------------------------------------------------------------------------
// Transforms — each one proven to do something, and nothing to a good file
// ---------------------------------------------------------------------------

function damagedItem(patch: Record<string, unknown>): Project {
  const project = parse(V1_ON_DISK) as unknown as Project
  Object.assign(project.timelines[0]!.tracks[0]!.items[0]!, patch)
  return project
}

const firstItem = (project: Project) => project.timelines[0]!.tracks[0]!.items[0]!

test('each transform is a no-op on the version-1 document', () => {
  for (const transform of TRANSFORMS) {
    const project = parse(V1_ON_DISK) as unknown as Project
    transform.apply(project)
    assert.deepEqual(project, parse(V1_ON_DISK), `${transform.name} changed a well-formed document`)
  }
})

test('a NaN saved as null in the layout falls back to identity, field by field', () => {
  // `JSON.stringify({ left: NaN })` is `{"left":null}` — the specimen must really be what the
  // writer produces, not a hand-made null that happens to look the same.
  const written = JSON.parse(JSON.stringify({ left: Number.NaN })) as { left: unknown }
  assert.equal(written.left, null, 'the specimen must be what JSON.stringify makes of NaN')

  const project = parse(V1_ON_DISK) as unknown as Project
  const layout = firstItem(project).layout as unknown as Record<string, unknown>
  layout.left = written.left
  layout.opacity = null
  layout.top = 12
  applyTransforms(project)
  const repaired = firstItem(project).layout
  assert.equal(repaired.left, 0)
  assert.equal(repaired.opacity, 1)
  assert.equal(repaired.top, 12, 'a finite field is left alone')
})

test('a partial adjustments object is filled field by field; a whole one is left alone', () => {
  // `{ brightness }` alone put undefined in front of the inspector's sliders, which threw.
  const partial = damagedItem({ adjustments: { brightness: 1.2, blur: null } })
  applyTransforms(partial)
  assert.deepEqual(firstItem(partial).adjustments, {
    brightness: 1.2,
    contrast: 1,
    saturate: 1,
    hueRotate: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0
  })
  const whole = { brightness: 0.9, contrast: 1.1, saturate: 1, hueRotate: 5, blur: 2, grayscale: 0, sepia: 0.1, invert: 0 }
  const kept = damagedItem({ adjustments: { ...whole } })
  applyTransforms(kept)
  assert.deepEqual(firstItem(kept).adjustments, whole)
  const junk = damagedItem({ adjustments: 'bright' })
  applyTransforms(junk)
  assert.equal(firstItem(junk).adjustments, undefined)
})

test('item timing is clamped to what the store would have allowed', () => {
  const project = damagedItem({ from: -5, durationInFrames: 0, fadeInFrames: 40, fadeOutFrames: -3 })
  applyTransforms(project)
  const item = firstItem(project)
  assert.equal(item.from, 0)
  assert.equal(item.durationInFrames, 1)
  assert.equal(item.fadeInFrames, 1, 'a fade longer than the clip is clamped to it')
  assert.equal(item.fadeOutFrames, 0)
})

test('non-finite volume, speed and source offset fall back to identity; a negative volume is silence', () => {
  const nulls = damagedItem({ volume: null, speed: 0, sourceStartUs: null })
  applyTransforms(nulls)
  assert.equal(firstItem(nulls).volume, 1)
  assert.equal(firstItem(nulls).speed, 1)
  assert.equal(firstItem(nulls).sourceStartUs, 0)

  const negative = damagedItem({ volume: -0.5 })
  applyTransforms(negative)
  assert.equal(firstItem(negative).volume, 0)
})

test('a track missing its required fields gets their defaults, and no optional field appears', () => {
  const project = parse(V1_ON_DISK) as unknown as Project
  const track = project.timelines[0]!.tracks[0]! as unknown as Record<string, unknown>
  delete track.locked
  delete track.muted
  delete track.items
  applyTransforms(project)
  const repaired = project.timelines[0]!.tracks[0]!
  assert.equal(repaired.locked, false)
  assert.equal(repaired.muted, false)
  assert.deepEqual(repaired.items, [])
  // Absence of `transitions` means "none"; materialising `[]` would churn every file on save.
  assert.equal('transitions' in project.timelines[0]!, false)
})

test('keyframes are repaired on the way in, through the real load path, and good ones pass untouched', () => {
  // The specimen is what the writer makes of a NaN key, not a hand-made null.
  const nanKey = JSON.parse(JSON.stringify({ frame: 4, value: Number.NaN })) as { value: unknown }
  assert.equal(nanKey.value, null, 'the specimen must be what JSON.stringify makes of NaN')

  const raw = parse(V1_ON_DISK) as unknown as Project
  const item = firstItem(raw) as unknown as Record<string, unknown>
  // Out of order, two keys on one frame (the later wins), a NaN, and a property a newer build
  // added — the sampler's binary search needs the first three repaired; the fourth must survive.
  item.keyframes = {
    opacity: [{ frame: 30, value: 1 }, { frame: 0, value: 0 }, { frame: 30, value: 0.5 }, nanKey],
    blur: [{ frame: 0, value: 2 }],
    width: []
  }
  ;(item.layout as Record<string, unknown>).scale = null
  const loaded = migrate(JSON.parse(JSON.stringify(raw)), '/tmp/keyed.bay')
  const repaired = firstItem(loaded)
  assert.deepEqual(repaired.keyframes, {
    opacity: [{ frame: 0, value: 0 }, { frame: 30, value: 0.5 }],
    blur: [{ frame: 0, value: 2 }]
  })
  assert.equal('scale' in repaired.layout, false, 'a NaN scale is removed, so it reads as 1')

  // Positive control: a well-formed keyed item loads exactly as written.
  const good = parse(V1_ON_DISK) as unknown as Project
  const goodItem = firstItem(good)
  goodItem.keyframes = { scale: [{ frame: 0, value: 1 }, { frame: 60, value: 1.1, ease: 'inOut' }] }
  goodItem.layout.scale = 1.2
  const kept = firstItem(migrate(JSON.parse(JSON.stringify(good)), '/tmp/good.bay'))
  assert.deepEqual(kept.keyframes, goodItem.keyframes)
  assert.equal(kept.layout.scale, 1.2)

  // Keys that repair to nothing are removed entirely, so the item takes the no-keys fast path.
  const empty = parse(V1_ON_DISK) as unknown as Project
  ;(firstItem(empty) as unknown as Record<string, unknown>).keyframes = { opacity: [nanKey] }
  assert.equal('keyframes' in firstItem(migrate(JSON.parse(JSON.stringify(empty)), '/tmp/e.bay')), false)
})
