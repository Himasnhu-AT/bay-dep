/**
 * Track heights are remembered per machine under a literal key. The key and its JSON shape are
 * read back by later builds, so they are pinned here as literals (CLAUDE.md: a test that read
 * the key through the module's own constant would rename with it).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type ViewModule = typeof import('./timelineView')

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => void values.set(key, String(value)),
    removeItem: (key: string): void => void values.delete(key)
  }
}

let generation = 0
async function launch(stub: ReturnType<typeof storage>): Promise<ViewModule> {
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  generation += 1
  return (await import(`${new URL('./timelineView.ts', import.meta.url).href}?launch=${generation}`)) as ViewModule
}

test("'bay.trackSizes' is read back per track, and an unknown size is dropped rather than trusted", async () => {
  const view = await launch(storage({ 'bay.trackSizes': '{"trk_a":"large","trk_b":"huge","trk_c":"small"}' }))
  assert.deepEqual(view.useTimelineView.getState().trackSizes, { trk_a: 'large', trk_c: 'small' })
})

test('garbled storage is every track at medium, not a crash', async () => {
  const view = await launch(storage({ 'bay.trackSizes': '{not json' }))
  assert.deepEqual(view.useTimelineView.getState().trackSizes, {})
})

test('setting a size writes the literal key; medium is stored as absence', async () => {
  const stub = storage()
  const view = await launch(stub)
  view.useTimelineView.getState().setTrackSize('trk_a', 'large')
  assert.equal(stub.values.get('bay.trackSizes'), '{"trk_a":"large"}')
  view.useTimelineView.getState().setTrackSize('trk_a', 'medium')
  assert.equal(stub.values.has('bay.trackSizes'), false)
})
