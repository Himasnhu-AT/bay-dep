import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickExecutorWindow, type WindowLike } from './executor-target'

const editor = (extra: Partial<WindowLike> = {}): WindowLike & { name: string } => ({
  name: 'editor', destroyed: false, composition: false, ...extra
})
const composition = (extra: Partial<WindowLike> = {}): WindowLike & { name: string } => ({
  name: 'composition', destroyed: false, composition: true, ...extra
})

test('a composition window is never chosen, even when it is first', () => {
  // The regression this file exists for. `getAllWindows()` has no defined order, and once a
  // composition is on the timeline it is often first — at which point every tool call is
  // delivered to a page with no MCP listener and is never answered.
  const picked = pickExecutorWindow([composition(), editor()])

  assert.equal(picked?.name, 'editor')
})

test('nor when there are several of them', () => {
  const picked = pickExecutorWindow([composition(), composition(), editor(), composition()])
  assert.equal(picked?.name, 'editor')
})

test('the editor is chosen when it is first, which is the case that always worked', () => {
  // The positive control: a picker that returned null for everything would pass the tests
  // above and break every tool call instead.
  assert.equal(pickExecutorWindow([editor(), composition()])?.name, 'editor')
})

test('a destroyed editor is skipped in favour of a live one', () => {
  const live = editor()
  const picked = pickExecutorWindow([editor({ destroyed: true }), live])
  assert.equal(picked, live)
})

test('no windows at all is null, not a throw', () => {
  assert.equal(pickExecutorWindow([]), null)
})

test('only composition windows is null — there is nowhere to send a call', () => {
  // Not an error state to crash on: it happens while the app is closing. The caller turns it
  // into a refusal the agent can act on, which beats waiting out a thirty second timeout to
  // learn the same thing.
  assert.equal(pickExecutorWindow([composition(), composition()]), null)
})

test('only destroyed windows is null', () => {
  assert.equal(pickExecutorWindow([editor({ destroyed: true })]), null)
})
