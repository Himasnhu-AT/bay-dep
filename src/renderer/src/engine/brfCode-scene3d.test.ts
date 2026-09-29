/**
 * `write_brf` refuses a 3D layer the renderer cannot build — with the frame and the field — rather
 * than accepting it and exporting a grey card.
 *
 * The module runs through the real worker handler; the 3D side is a `Scene3dRuntime` whose
 * renderer extrudes through the real `GeometryCache` with the real built-in Inter file, so a
 * missing glyph is found by the same code the app draws with. (The real `Scene3dRenderer` needs a
 * WebGL canvas and Vite's inlined font, neither of which Node has.)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js/dist/opentype.mjs'
import type { Scene3dFrame } from '@shared/scene3d'
import { BrfCodeRuntime, type BrfWorkerReply, type BrfWorkerRequest, type WorkerLike } from './brfCode'
import { createHandler } from './brfWorkerCore'
import { GeometryCache } from './text3dGeometry'
import { Scene3dRuntime } from './scene3dRuntime'
import type { Scene3dRenderer } from './scene3d'

const working = (): WorkerLike => {
  const handle = createHandler()
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => worker.onmessage?.({ data: handle(message as BrfWorkerRequest) } as MessageEvent<BrfWorkerReply>))
    },
    terminate() {}
  }
  return worker
}

const bytes = readFileSync('node_modules/@fontsource/inter/files/inter-latin-900-normal.woff')
const inter = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

/** A renderer module that prepares text as the real one does: extrude, or say why not, and where. */
function extrudingModule(budget?: number) {
  class Extruding {
    readonly #cache = new GeometryCache()
    prepare(scene: Scene3dFrame) {
      for (const [index, o] of scene.objects.entries()) {
        if (o.type !== 'text3d') continue
        const got = this.#cache.text(inter, 'builtin:900', o)
        if ('error' in got) return { error: `3D text ${JSON.stringify(o.text)}: ${got.error}`, object: index }
        if (budget !== undefined && (got.geometry.getAttribute('position')?.count ?? 0) > budget) return { error: 'over budget', object: index }
      }
      return { ready: true as const }
    }
    render() {
      return { error: 'no canvas under Node' }
    }
    dispose() {}
    forceContextLoss() {}
  }
  return { Scene3dRenderer: Extruding as unknown as typeof Scene3dRenderer }
}

const MODULE = (words: string) => `
  export default ({ frame }) => (
    <scene duration={1}>
      <rect w={10} h={10} fill="#fff" />
      <group>
        <scene3d x="50%" y="50%" w="100%" h="100%">
          <light3d type="ambient" />
          <text3d>{frame < 15 ? 'Go now' : ${JSON.stringify(words)}}</text3d>
        </scene3d>
      </group>
    </scene>
  )`

function runtimeWith(module: Promise<ReturnType<typeof extrudingModule>>): BrfCodeRuntime {
  const runtime = new BrfCodeRuntime()
  runtime.useWorkers(working)
  runtime.useScene3d(new Scene3dRuntime(() => module, () => []))
  return runtime
}

test('a glyph the font lacks is refused by write_brf, naming the frame and the field', { timeout: 10_000 }, async () => {
  const refused = await runtimeWith(Promise.resolve(extrudingModule())).verify(MODULE('Go → now'), 30, 1920, 1080)
  assert.ok(!refused.ok, 'accepted a text whose arrow the font has no glyph for')
  // The glyph appears only from frame 15: the refusal names a sampled frame at or after it, and
  // the text3d's path inside the group — objects[1], after the light.
  assert.match(refused.error, /^frame (1[5-9]|2\d), layers\[1\]\.layers\[0\]\.objects\[1\]: 3D text "Go → now": the font has no glyph for "→"/)

  const accepted = await runtimeWith(Promise.resolve(extrudingModule())).verify(MODULE('Go -> now'), 30, 1920, 1080)
  assert.ok(accepted.ok, `the positive control: ${accepted.ok ? '' : accepted.error}`)
})

test('geometry the renderer refuses on any sampled frame is refused when written', { timeout: 10_000 }, async () => {
  const refused = await runtimeWith(Promise.resolve(extrudingModule(1))).verify(MODULE('Go -> now'), 30, 1920, 1080)
  assert.ok(!refused.ok && /objects\[1\]: over budget/.test(refused.error), JSON.stringify(refused))
})

test('where the 3D renderer cannot load, write_brf does not refuse on its account', { timeout: 10_000 }, async () => {
  // The drawing reports that on every frame; refusing here would block every 3D module in a build
  // (or a test process) that cannot draw 3D at all.
  const failing = Promise.reject(new Error('chunk missing')) as Promise<ReturnType<typeof extrudingModule>>
  failing.catch(() => {})
  const result = await runtimeWith(failing).verify(MODULE('Go → now'), 30, 1920, 1080)
  assert.ok(result.ok, result.ok ? '' : result.error)
})
