import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveScene3d } from '@shared/scene3d'
import { Scene3dRuntime } from './scene3dRuntime'
import type { Scene3dRenderer } from './scene3d'

const scene = resolveScene3d({ objects: [{ type: 'text3d', text: 'Hi' }] }, { color: (c) => c, text: (t) => t })

/** A stand-in for the lazily loaded module: records calls, answers as told. */
function fakeModule(answer: ReturnType<Scene3dRenderer['prepare']> = { ready: true }) {
  const calls: string[] = []
  class Fake {
    prepare() {
      calls.push('prepare')
      return answer
    }
    render() {
      calls.push('render')
      return { error: 'fake has no canvas' }
    }
    dispose() {
      calls.push('dispose')
    }
    forceContextLoss() {}
  }
  return { calls, module: { Scene3dRenderer: Fake as unknown as typeof Scene3dRenderer } }
}

test('the first 3D draw is pending while the renderer loads, then ready — and the wait is observable', { timeout: 5000 }, async () => {
  const { calls, module } = fakeModule()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const runtime = new Scene3dRuntime(() => gate.then(() => module), () => [])
  let ready = 0
  runtime.onReady(() => ready++)

  assert.deepEqual(runtime.prepare(scene), { pending: true })
  assert.deepEqual(runtime.prepare(scene), { pending: true }, 'still loading: pending again, one load')
  let settled = false
  const waiting = runtime.settle(4000).then(() => (settled = true))
  await Promise.resolve()
  assert.equal(settled, false, 'settle must wait for the load — export would otherwise write the frame without 3D')

  release()
  await waiting
  assert.equal(ready, 1, 'onReady tells the preview to redraw')
  assert.deepEqual(runtime.prepare(scene), { ready: true })
  assert.deepEqual(calls, ['prepare'])
})

test('a renderer that cannot load is every 3D layer\'s error, not a wait that never ends', { timeout: 5000 }, async () => {
  const runtime = new Scene3dRuntime(() => Promise.reject(new Error('chunk missing')), () => [])
  assert.deepEqual(runtime.prepare(scene), { pending: true })
  await runtime.settle(1000)
  const after = runtime.prepare(scene)
  assert.ok('error' in after && /the 3D renderer could not be loaded \(chunk missing\)/.test(after.error), JSON.stringify(after))
})

test('dispose frees the renderer; the next draw makes a new one from the loaded module', { timeout: 5000 }, async () => {
  const { calls, module } = fakeModule({ pending: true })
  let loads = 0
  const runtime = new Scene3dRuntime(() => {
    loads++
    return Promise.resolve(module)
  }, () => [])
  runtime.prepare(scene)
  await runtime.settle(1000)
  assert.deepEqual(runtime.prepare(scene), { pending: true }, "the renderer's own answer passes through")
  runtime.dispose()
  runtime.prepare(scene)
  assert.deepEqual(calls, ['prepare', 'dispose', 'prepare'])
  assert.equal(loads, 1, 'the chunk is loaded once')
})
