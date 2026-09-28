/**
 * A double-click on a title in the viewer (`requestTextFocus`) must show the inspector in either
 * layout mode. In Resolve it is a region to unhide; in the AI layout it is a drawer to open —
 * unhiding a region there changes nothing on screen. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// The DOM pieces requestTextFocus touches, as no-ops: the store is what is under test.
const g = globalThis as Record<string, unknown>
g.requestAnimationFrame ??= (): number => 0
g.window ??= globalThis
g.dispatchEvent ??= (): boolean => true
g.CustomEvent ??= class {
  type: string
  constructor(type: string) {
    this.type = type
  }
}

const { requestTextFocus } = await import('./viewer')
const { useEditor } = await import('@/store/editor')
const s = () => useEditor.getState()

test('in the AI layout, a text-focus request opens the inspector drawer', () => {
  s().setLayoutMode('ai')
  s().closeAiPanels()
  requestTextFocus('some-item')
  assert.equal(s().aiPanels.inspector, true)
  s().setLayoutMode('resolve')
})

test('in Resolve, it unhides the inspector region and opens no drawer', () => {
  s().setLayoutMode('resolve')
  s().setRegionHidden('inspector', true)
  requestTextFocus('some-item')
  assert.equal(s().hiddenRegions.inspector, false)
  assert.equal(s().aiPanels.inspector, false)
})
