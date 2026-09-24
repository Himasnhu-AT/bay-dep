import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ISOLATED_POINTER_EVENTS, isolatePointerEvents } from './isolate'

test('a portalled surface stops presses, clicks and the context menu from reaching its React ancestors', () => {
  // The marker popover's buttons failed on pointerdown (the ruler scrubbed) and click; a
  // right-click inside a menu must not open the lane's menu under it.
  for (const name of ['onPointerDown', 'onMouseDown', 'onClick', 'onContextMenu'] as const) {
    assert.ok(ISOLATED_POINTER_EVENTS.includes(name), `${name} is not isolated`)
  }
  for (const name of ISOLATED_POINTER_EVENTS) {
    let stopped = 0
    isolatePointerEvents[name]({ stopPropagation: () => void stopped++ })
    assert.equal(stopped, 1, `${name} did not stop propagation`)
  }
})

test('every portalled surface primitive spreads the isolation onto its root', () => {
  // A textual check, proven: removing the spread from either file fails it. The primitives are
  // React and DOM, which plain Node cannot mount, and the bug was the spread's absence.
  for (const file of ['Floating.tsx', 'Modal.tsx']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    assert.match(source, /createPortal\(/, `${file} is no longer portalled; revisit this test`)
    assert.match(source, /\{\.\.\.isolatePointerEvents\}/, `${file} does not isolate its pointer events`)
  }
})
