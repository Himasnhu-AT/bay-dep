/**
 * A text item in an imported family whose face is still loading is pending, not drawn — drawn now
 * it would be in a fallback face, which looks deliberate and has no visual cue. Beside it, the
 * control: the same item in a family the project did not import draws at once. And once the face
 * has settled, the item draws.
 *
 * Under Node there is no document, so the registry's loads fail — one microtask after they start.
 * That gap is exactly the "still loading" state the compositor must wait through.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { defaultTextStyle } from '@shared/project'
import { Compositor } from './compositor'
import { importedFonts } from './importedFonts'
import type { MediaEntry, MediaPool } from './mediaPool'

class FakePool {
  beginGeneration(): void {}
  acquire(asset: Asset, slot = 0): MediaEntry {
    return { assetId: asset.id, slot, kind: asset.kind, element: null as unknown as HTMLVideoElement, status: 'loading' }
  }
  inUse(): boolean {
    return false
  }
}

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

function fixture(family: string): { project: Project; timeline: Timeline } {
  const font: Asset = {
    ...base,
    id: 'font',
    kind: 'font',
    name: 'Archivo.ttf',
    path: '/fonts/archivo.ttf',
    font: { family: 'Archivo', fullName: null, postscriptName: null, weight: '100 900', stretch: '62% 125%', style: 'normal', axes: [], format: 'truetype', importedFrom: '/x.ttf' }
  }
  const words: Asset = { ...base, id: 'words', kind: 'text', name: 'Title', path: null, text: 'Brand Typography', hasVideo: true }
  const item: Item = {
    id: 'title', assetId: 'words', trackId: 'v1', from: 0, durationInFrames: 30, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 400, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
    text: { ...defaultTextStyle(96), fontFamily: family }
  }
  const timeline: Timeline = {
    id: 'tl', name: 'tl', fps: 30, width: 1920, height: 1080, background: '#000000',
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item] }]
  }
  return { project: { id: 'p', name: 'p', version: 1, assets: [font, words], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}

test('text in an imported family waits for its face; text in any other family draws at once', async () => {
  const compositor = new Compositor(new FakePool() as unknown as MediaPool)

  // Control first, while the registry is empty: an ordinary family draws.
  const plain = fixture('Georgia, serif')
  importedFonts.sync([])
  const control = compositor.drawFrame(fakeContext(), plain.project, plain.timeline, 0)
  assert.equal(control.drawn, 1, 'the control draws')
  assert.equal(control.pending, 0)

  const { project, timeline } = fixture('"Archivo", sans-serif')
  const first = compositor.drawFrame(fakeContext(), project, timeline, 0)
  assert.equal(first.pending, 1, 'the face registered by this draw is still loading')
  assert.equal(first.drawn, 0, 'so nothing was painted in a fallback face')
  assert.deepEqual(first.pendingNames, ['Title'])
  // The same draw with the control family, while Archivo is loading: not its to wait on.
  assert.equal(compositor.drawFrame(fakeContext(), plain.project, plain.timeline, 0).pending, 0)

  await importedFonts.settle(1000)
  const after = compositor.drawFrame(fakeContext(), project, timeline, 0)
  assert.equal(after.pending, 0, 'settled (here: failed, with no document) — no longer waited for')
  assert.equal(after.drawn, 1)
  importedFonts.sync([])
})
