/**
 * A title's size has one answer. The compositor, the inspector's Type section and the fit hint
 * all read `resolvedTextStyle`; before, the compositor drew an unstyled title at 40% of its box
 * (432 px on 1080) while the inspector said `defaultTextStyle()`'s 96, and the first style edit
 * snapped it down. So: the size the compositor actually drew equals what the resolver reports,
 * for an unstyled item and a styled one, and a newly placed title carries an explicit style —
 * the inspector's 96 is then what draws.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { defaultTextStyle } from '@shared/project'
import { Compositor } from '../engine/compositor'
import { resolvedTextStyle } from '../engine/text'
import type { MediaEntry, MediaPool } from '../engine/mediaPool'

class FakePool {
  beginGeneration(): void {}
  acquire(asset: Asset, slot = 0): MediaEntry {
    return { assetId: asset.id, slot, kind: asset.kind, element: null as unknown as HTMLVideoElement, status: 'loading' }
  }
  inUse(): boolean {
    return false
  }
}

/** Widths independent of size and short: nothing wraps or shrinks, so the drawn size is the asked one. */
function fakeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
    measureText: (s: string) => ({ width: s.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
  }
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : () => {}),
    set: () => true
  }) as unknown as CanvasRenderingContext2D
}

const base = { durationUs: 0, width: null, height: null, fps: null, hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0 }

function frameWith(item: Item): { project: Project; timeline: Timeline } {
  const words: Asset = { ...base, id: 'words', kind: 'text', name: 'Title', path: null, text: 'Title' }
  const timeline: Timeline = {
    id: 'tl', name: 'tl', fps: 30, width: 1920, height: 1080, background: '#000000',
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item] }]
  }
  return { project: { id: 'p', name: 'p', version: 1, assets: [words], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}

function title(text?: Item['text']): Item {
  return {
    id: 'title', assetId: 'words', trackId: 'v1', from: 0, durationInFrames: 30, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
    ...(text ? { text } : {})
  }
}

function drawnSize(item: Item): number {
  const { project, timeline } = frameWith(item)
  const stats = new Compositor(new FakePool() as unknown as MediaPool).drawFrame(fakeContext(), project, timeline, 0)
  const fit = stats.textFits[0]
  assert.ok(fit, 'the title drew')
  assert.equal(fit.scale, 1, 'nothing shrank, so the drawn size is the requested one')
  return fit.fontSize
}

test('an unstyled title: the size the compositor draws is the size the inspector is shown', () => {
  const item = title()
  const shown = resolvedTextStyle(item).fontSize
  assert.equal(drawnSize(item), shown)
  // The specimen is the one the bug hid in: the pre-TextStyle look is not 96, so an inspector
  // showing `defaultTextStyle()` for this item would be showing a different number.
  assert.notEqual(shown, defaultTextStyle().fontSize)
})

test('a styled title: the compositor draws its own size, and the resolver hands it back unchanged', () => {
  const item = title({ ...defaultTextStyle(), fontSize: 120 })
  assert.equal(resolvedTextStyle(item).fontSize, 120)
  assert.equal(drawnSize(item), 120)
})

test('a placed title carries an explicit style, so the inspector’s 96 is what draws', async () => {
  const { useEditor, emptyProject } = await import('./editor')
  useEditor.getState().setProject(emptyProject(), { resetHistory: true })
  useEditor.getState().addAssets([{ ...base, id: 'ast_t', kind: 'text', name: 'Title', path: null, text: 'Title' }])
  const itemId = useEditor.getState().placeAsset('ast_t', 0)
  const placed = useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === itemId)
  assert.ok(placed, 'the title was placed')
  assert.deepEqual(placed.text, defaultTextStyle())
  assert.equal(drawnSize({ ...placed, trackId: 'v1', assetId: 'words' }), defaultTextStyle().fontSize)
})
