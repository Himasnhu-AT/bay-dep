/**
 * Which regions each layout mode shows, and which AI drawers are open. Run with `pnpm test`.
 *
 * The requirement, not the implementation: AI mode is exactly three always-on regions (viewer,
 * agent, media pool) plus drawers on demand; Resolve mode is the page layout and never an AI
 * drawer, whatever the store happens to hold.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutRegions } from './layoutRegions'

const NONE = { timeline: false, inspector: false, pages: false }
const ALL = { timeline: true, inspector: true, pages: true }

test('Resolve: the page frame, the dock, the page bar and the panel toggles; no AI chrome', () => {
  const r = layoutRegions('resolve', NONE)
  assert.equal(r.viewer, true)
  assert.equal(r.agent, 'dock')
  assert.equal(r.pageFrame, true)
  assert.equal(r.pageBar, true)
  assert.equal(r.panelToggles, true)
  assert.equal(r.mediaPool, false)
  assert.equal(r.aiToolbar, false)
})

test('Resolve never shows an AI drawer, even with every AI panel set in the store', () => {
  assert.deepEqual(layoutRegions('resolve', ALL).drawers, { timeline: false, side: null })
})

test('AI with nothing open: exactly the viewer, the agent and the media pool', () => {
  const r = layoutRegions('ai', NONE)
  const shown = [
    r.viewer && 'viewer',
    r.agent === 'primary' && 'agent',
    r.mediaPool && 'mediaPool',
    r.pageFrame && 'pageFrame',
    r.pageBar && 'pageBar',
    r.panelToggles && 'panelToggles'
  ].filter(Boolean)
  assert.deepEqual(shown, ['viewer', 'agent', 'mediaPool'])
  assert.equal(r.aiToolbar, true, 'the toolbar is how the rest opens')
  assert.deepEqual(r.drawers, { timeline: false, side: null })
})

test('AI drawers follow the store: the timeline along the bottom, one side drawer', () => {
  assert.deepEqual(layoutRegions('ai', { ...NONE, timeline: true }).drawers, { timeline: true, side: null })
  assert.deepEqual(layoutRegions('ai', { ...NONE, inspector: true }).drawers, { timeline: false, side: 'inspector' })
  assert.deepEqual(layoutRegions('ai', { ...NONE, pages: true, timeline: true }).drawers, { timeline: true, side: 'pages' })
  // A tie the store should never produce still yields one side drawer, not two.
  assert.equal(layoutRegions('ai', ALL).drawers.side, 'inspector')
})
