/**
 * `item.pan` is an additive optional field of the version-1 `.bay` format (CLAUDE.md: a new
 * optional field needs no bump). These load the literal version-1 document with the field added,
 * through the real load path, and check it arrives — and that a damaged value reads as centre
 * rather than breaking the mix.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_VERSION, type Project } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { panGains } from '@shared/audio-gain'
import { migrate } from './persistence'

const firstItem = (project: Project) => project.timelines[0]!.tracks[0]!.items[0]!

function withPan(pan: unknown): unknown {
  const raw = JSON.parse(V1_ON_DISK) as Project
  ;(firstItem(raw) as unknown as Record<string, unknown>).pan = pan
  // Through JSON, as a file on disk would be: a NaN is written as null.
  return JSON.parse(JSON.stringify(raw))
}

test('pan is still a version-1 field: adding it needed no format bump', () => {
  // If this fails, the version moved — and a bump needs a migration and a fixture, not this test.
  assert.equal(PROJECT_VERSION, 1)
})

test('a version-1 document carrying pan loads with it intact', () => {
  const loaded = migrate(withPan(-0.35), '/tmp/panned.bay')
  assert.equal(firstItem(loaded).pan, -0.35)
  // Positive control: the same document without the field loads without it.
  const plain = migrate(JSON.parse(V1_ON_DISK), '/tmp/plain.bay')
  assert.equal('pan' in firstItem(plain), false)
})

test('a pan saved as NaN (null on disk) or out of range loads, and plays centred or clamped', () => {
  const nan = JSON.parse(JSON.stringify({ pan: Number.NaN })) as { pan: unknown }
  assert.equal(nan.pan, null, 'the specimen must be what JSON.stringify makes of NaN')
  const damaged = firstItem(migrate(withPan(Number.NaN), '/tmp/nan.bay'))
  assert.deepEqual(panGains(damaged.pan), { left: 1, right: 1 })
  const wide = firstItem(migrate(withPan(5), '/tmp/wide.bay'))
  assert.deepEqual(panGains(wide.pan), panGains(1))
})
