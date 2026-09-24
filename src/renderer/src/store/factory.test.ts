/**
 * The store's small naming helpers (`store/factory.ts`).
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextMarkerName, nextTrackName } from './factory'
import type { Timeline, Track } from '@shared/project'

test('a new marker never takes the name of one that is still there', () => {
  // The verifier's case: Marker 1 and Marker 2 added, Marker 1 deleted — counting named the next
  // one "Marker 2" again.
  const left = [{ label: 'Marker 2' }]
  const name = nextMarkerName(left)
  assert.ok(!left.some((marker) => marker.label === name), `${name} is already taken`)
  assert.equal(name, 'Marker 1', 'the lowest free number')
  assert.equal(nextMarkerName([{ label: 'Marker 1' }, { label: 'Hook' }, { label: 'Marker 3' }]), 'Marker 2')
  // Positive control: an unbroken run continues it.
  assert.equal(nextMarkerName([{ label: 'Marker 1' }, { label: 'Marker 2' }]), 'Marker 3')
  assert.equal(nextMarkerName(undefined), 'Marker 1')
})

test('a new track takes the lowest unused name, not the count', () => {
  const track = (name: string, kind: Track['kind']): Track =>
    ({ id: name, name, kind, locked: false, muted: false, hidden: false, items: [] }) as Track
  const timeline = { tracks: [track('V1', 'video'), track('V3', 'video'), track('A1', 'audio')] } as Timeline
  // V2 was deleted: counting two video tracks would call the new one "V3", which exists.
  assert.equal(nextTrackName(timeline, 'video'), 'V2')
  assert.equal(nextTrackName(timeline, 'audio'), 'A2')
})
