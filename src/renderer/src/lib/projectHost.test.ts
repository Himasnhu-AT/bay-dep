/**
 * The New Project choice's rules. The remembered editor is read from storage a later build wrote
 * to, so the key and the stored values are literals here, not the module's own constants.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ResolveState, ResolveStatus } from '@shared/host'
import {
  canOpenResolve,
  hostAfterKey,
  hostToRemember,
  NEW_PROJECT_HOST_KEY,
  rememberedHost,
  resolveChoiceNote,
  resolvePollMs,
  resolveTone
} from './projectHost'

const STATES: ResolveState[] = ['not-installed', 'not-set-up', 'not-running', 'bridge-needed', 'ready']

test('the remembered editor lives at a fixed key', () => {
  assert.equal(NEW_PROJECT_HOST_KEY, 'bay.newProject.host')
})

test('Enter creates in the remembered editor; nothing stored is bay', () => {
  assert.equal(rememberedHost('resolve'), 'resolve')
  assert.equal(rememberedHost('bay'), 'bay')
  assert.equal(rememberedHost(null), 'bay')
})

test('a stored value this build does not know falls back to bay', () => {
  for (const garbage of ['', 'premiere', 'Resolve', ' resolve', 'RESOLVE', '{"host":"resolve"}', 'null', '1']) {
    assert.equal(rememberedHost(garbage), 'bay', JSON.stringify(garbage))
  }
})

test('what is stored reads back as the same editor', () => {
  assert.equal(hostToRemember('resolve'), 'resolve')
  assert.equal(hostToRemember('bay'), null)
  assert.equal(rememberedHost(hostToRemember('resolve')), 'resolve')
  assert.equal(rememberedHost(hostToRemember('bay')), 'bay')
})

test('arrow keys move between the two editors and stop at the ends', () => {
  assert.equal(hostAfterKey('bay', 'ArrowRight'), 'resolve')
  assert.equal(hostAfterKey('bay', 'ArrowDown'), 'resolve')
  assert.equal(hostAfterKey('resolve', 'ArrowLeft'), 'bay')
  assert.equal(hostAfterKey('resolve', 'ArrowUp'), 'bay')
  // The ends: no wrap, and nothing past Resolve can be chosen.
  assert.equal(hostAfterKey('resolve', 'ArrowRight'), 'resolve')
  assert.equal(hostAfterKey('bay', 'ArrowLeft'), 'bay')
  // Any other key leaves the choice alone.
  for (const key of ['Enter', 'Tab', 'a', ' ', 'Escape']) {
    assert.equal(hostAfterKey('bay', key), 'bay', key)
    assert.equal(hostAfterKey('resolve', key), 'resolve', key)
  }
})

test('the connection is asked about every 5 s until ready, then every 30 s', () => {
  for (const state of STATES) {
    assert.equal(resolvePollMs(state), state === 'ready' ? 30_000 : 5_000, state)
  }
  assert.equal(resolvePollMs(null), 5_000)
  // Never a tight loop, whatever the state.
  for (const state of [...STATES, null]) assert.ok(resolvePollMs(state) >= 5_000)
})

test('choosing Resolve before it can be reached says so; connected says nothing', () => {
  for (const state of STATES) {
    const note = resolveChoiceNote({ state })
    if (state === 'ready') assert.equal(note, null)
    else {
      assert.ok(note, state)
      assert.match(note, /create the project now/)
      assert.match(note, /until this is fixed/)
    }
  }
  assert.equal(resolveChoiceNote(null), null)
})

test('the dot is green only when connected, and Open Resolve is offered only when it is closed', () => {
  for (const state of STATES) {
    const status: ResolveStatus = { state }
    assert.equal(resolveTone(status), state === 'ready' ? 'success' : 'warning', state)
    assert.equal(canOpenResolve(status), state === 'not-running', state)
  }
  assert.equal(resolveTone(null), 'neutral')
  assert.equal(canOpenResolve(null), false)
})
