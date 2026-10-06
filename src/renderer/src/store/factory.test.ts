/**
 * The store's small naming helpers (`store/factory.ts`).
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newId, nextMarkerName, nextTrackName } from './factory'
import { distinguishingPrefixes, resolveId } from '@shared/mcp'
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

test('ids made in the same call differ within their first 10 characters, which is what the tools accept', () => {
  // The fault this guards: a placed video and its sound clip are made in one millisecond, and
  // with the time first their ids shared 12 characters — "the first 10 are enough" matched both.
  const ids = Array.from({ length: 200 }, () => newId('itm'))
  assert.equal(new Set(ids).size, ids.length, 'every id is distinct')
  const prefixes = new Set(ids.map((id) => id.slice(0, 10)))
  // 200 ids over 36^6 prefixes: a collision is a one-in-100,000 event; two would be the fault.
  assert.ok(prefixes.size >= ids.length - 1, `${ids.length - prefixes.size} of ${ids.length} ids share a 10-character prefix`)
  for (const id of ids) assert.match(id, /^itm_[a-z0-9]{12,}$/)
})

test('an ambiguous id is refused with prefixes that tell the candidates apart; the nearest unambiguous one resolves', () => {
  const ids = ['itm_abcdefgh1xx111', 'itm_abcdefgh1yy222', 'itm_zzzzzzzzzzzzzz']
  const refused = resolveId('itm_abcdef', ids)
  assert.equal(refused.ok, false)
  const offered = (refused as { error: string }).error.match(/itm_[a-z0-9]+/g)!.slice(1)
  assert.equal(offered.length, 2)
  assert.notEqual(offered[0], offered[1], 'two different clips must not be offered under one prefix')
  for (const prefix of offered) assert.equal(resolveId(prefix, ids).ok, true, `${prefix} must resolve when typed back`)
  assert.deepEqual(resolveId('itm_zzzzzz', ids), { ok: true, id: 'itm_zzzzzzzzzzzzzz' })
  assert.deepEqual(distinguishingPrefixes(['itm_abcdefgh1xx111', 'itm_qqqqqqqqqqqqqq']), ['itm_abcdefgh', 'itm_qqqqqqqq'])
})
