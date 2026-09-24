/**
 * File › Open Recent's list: Clear Menu hides the listed projects without forgetting them, and a
 * project opened or saved again comes back.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecentProject } from '@shared/ipc'
import { menuRecents, parseHidden, RECENT_MENU_HIDDEN_KEY, RECENT_MENU_LIMIT, unhide } from './recent-menu'

const row = (name: string): RecentProject => ({ id: name, name, filePath: `/p/${name}.bay`, updatedAt: 0 })

test('the hidden list lives under a key later builds read: the literal is pinned', () => {
  assert.equal(RECENT_MENU_HIDDEN_KEY, 'recentMenuHidden')
})

test('cleared projects leave the menu; the rest stay, in order', () => {
  const rows = [row('a'), row('b'), row('c')]
  assert.deepEqual(menuRecents(rows, ['/p/b.bay']).map((r) => r.name), ['a', 'c'])
  // Positive control: nothing hidden, nothing dropped.
  assert.deepEqual(menuRecents(rows, []).map((r) => r.name), ['a', 'b', 'c'])
})

test('the menu shows at most the limit, the newest', () => {
  const rows = Array.from({ length: RECENT_MENU_LIMIT + 5 }, (_, i) => row(`p${i}`))
  const shown = menuRecents(rows, [])
  assert.equal(shown.length, RECENT_MENU_LIMIT)
  assert.equal(shown[0]?.name, 'p0')
})

test('opening a cleared project brings it back; one that was never hidden changes nothing', () => {
  assert.deepEqual(unhide(['/p/a.bay', '/p/b.bay'], '/p/a.bay'), ['/p/b.bay'])
  assert.equal(unhide(['/p/b.bay'], '/p/a.bay'), null)
})

test('a damaged stored list reads as nothing hidden, never as a throw at menu build', () => {
  assert.deepEqual(parseHidden(null), [])
  assert.deepEqual(parseHidden('not json'), [])
  assert.deepEqual(parseHidden('{"a":1}'), [])
  assert.deepEqual(parseHidden('["/p/a.bay", 3]'), ['/p/a.bay'])
})
