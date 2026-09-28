import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CanvasSize, releaseRenderer, type ContextOwner } from './glContext'

function recorder(options: { lossThrows?: boolean } = {}): ContextOwner & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    forceContextLoss() {
      calls.push('forceContextLoss')
      if (options.lossThrows) throw new Error('context already lost')
    },
    dispose() {
      calls.push('dispose')
    },
    setSize(w, h) {
      calls.push(`setSize ${w}x${h}`)
    }
  }
}

test('releasing a renderer loses its context before disposing it, so no context outlives a detach', () => {
  const r = recorder()
  releaseRenderer(r)
  assert.deepEqual(r.calls, ['forceContextLoss', 'dispose'])
})

test('a context that refuses to be lost again is still disposed', () => {
  const r = recorder({ lossThrows: true })
  releaseRenderer(r)
  assert.deepEqual(r.calls, ['forceContextLoss', 'dispose'])
})

test('the canvas is resized only when the size changes, and again after a reset', () => {
  const r = recorder()
  const size = new CanvasSize()
  size.resize(r, 640, 360)
  size.resize(r, 640, 360)
  size.resize(r, 640, 360)
  size.resize(r, 1280, 720)
  size.resize(r, 1280, 720)
  size.reset()
  size.resize(r, 1280, 720)
  assert.deepEqual(r.calls, ['setSize 640x360', 'setSize 1280x720', 'setSize 1280x720'])
})
