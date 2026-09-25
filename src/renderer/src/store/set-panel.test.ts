/**
 * `setPanel` maps the old left-rail ids onto the workspace. The promise is that the id asked for
 * ends up *visible*: a library tab set on a page that does not show the library is a panel that
 * opened nowhere.
 *
 * The Media page shows the media pool only (`MediaBrowser`, no library tabs), so `media` may stay
 * there and every other library tab must move to the Edit page.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor } from './editor'

const state = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

for (const panel of ['transcript', 'effects', 'text', 'templates'] as const) {
  test(`setPanel('${panel}') from the Media page shows the Edit page's library`, () => {
    state().setPage('media')
    assert.equal(state().page, 'media')
    state().setPanel(panel)
    assert.equal(state().page, 'edit', `the ${panel} tab is not on the Media page`)
    assert.equal(state().libraryTab, panel === 'transcript' ? 'transcript' : 'effects')
  })
}

test("setPanel('media') on the Media page stays there (the pool is what it shows)", () => {
  state().setPage('media')
  state().setPanel('media')
  assert.equal(state().page, 'media')
  assert.equal(state().libraryTab, 'media')
})

test('setPanel from the Color, Audio and Deliver pages goes to Edit', () => {
  for (const page of ['color', 'deliver', 'audio'] as const) {
    state().setPage(page)
    state().setPanel('transcript')
    assert.equal(state().page, 'edit', `from ${page}`)
  }
})

test("setPanel('export') goes to Deliver and setPanel('agent') docks without moving page", () => {
  state().setPage('edit')
  state().setPanel('export')
  assert.equal(state().page, 'deliver')
  state().setAgentDocked(false)
  state().setPanel('agent')
  assert.equal(state().agentDocked, true)
  assert.equal(state().page, 'deliver')
})
