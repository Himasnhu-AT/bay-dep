/**
 * The probe harness (`test/app/cdp.mjs`) must not read the Inspector or the timeline in the AI
 * layout, where the Inspector is a closed drawer and the timeline sits in the parking box: every
 * such probe would report a working field dead. `showInspector` and `RESOLVE_LAYOUT` (which
 * `attach()` runs) are page-side scripts, so they are run here against the real store with a
 * stand-in `evaluate`. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor } from '@/store/editor'

// A computed specifier: the harness is plain .mjs outside the typed tree.
const harness = new URL('../../../../../test/app/cdp.mjs', import.meta.url).href
const cdp = (await import(harness)) as {
  showInspector(evaluate: (code: string) => Promise<unknown>, tab: string): Promise<unknown>
  RESOLVE_LAYOUT: string
}

/** What CDP's Runtime.evaluate does with the script, against a page holding this store. */
const evaluate = async (code: string): Promise<unknown> => {
  const page = { bayEngine: { store: useEditor } }
  const raf = (callback: () => void): number => {
    setTimeout(callback, 0)
    return 0
  }
  return new Function('window', 'requestAnimationFrame', `return ${code}`)(page, raf)
}

test('showInspector leaves the AI layout for Resolve, where the Inspector is mounted', async () => {
  useEditor.getState().setLayoutMode('ai')
  const shown = await cdp.showInspector(evaluate, 'audio')
  assert.equal(useEditor.getState().layoutMode, 'resolve')
  assert.equal(useEditor.getState().page, 'edit')
  assert.equal(shown, true)
})

test('RESOLVE_LAYOUT switches an AI-layout editor to Resolve and leaves Resolve alone', async () => {
  useEditor.getState().setLayoutMode('ai')
  await evaluate(cdp.RESOLVE_LAYOUT)
  assert.equal(useEditor.getState().layoutMode, 'resolve')
  // Positive control: already in Resolve, nothing changes and nothing throws.
  await evaluate(cdp.RESOLVE_LAYOUT)
  assert.equal(useEditor.getState().layoutMode, 'resolve')
})
