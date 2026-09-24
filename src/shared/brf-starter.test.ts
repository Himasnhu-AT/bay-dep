import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrf, probeBrf, renderBrf } from './brf-code'
import { BRF_STARTER } from './brf-starter'

test('the starter module is the guide\'s first example, byte for byte', () => {
  const guide = readFileSync('src/main/mcp/docs/brf.md', 'utf8')
  const block = /## The module\n\n```tsx\n([\s\S]*?)```/.exec(guide)?.[1]
  assert.ok(block, 'the guide no longer has a "## The module" tsx block')
  assert.equal(BRF_STARTER, block)
})

test('the starter module compiles and runs on every frame, portrait and landscape', () => {
  const loaded = loadBrf(BRF_STARTER)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
  for (const [width, height] of [[1080, 1920], [1920, 1080]] as const) {
    const meta = probeBrf(loaded.module, 30, width, height)
    assert.ok(meta.ok, meta.ok ? '' : meta.error)
    const frames = Math.ceil(meta.meta.duration * 30)
    assert.ok(frames > 0)
    for (let frame = 0; frame < frames; frame++) {
      const out = renderBrf(loaded.module, { frame, fps: 30, width, height, vars: loaded.module.vars })
      assert.ok(out.ok, `frame ${frame}: ${out.ok ? '' : out.error}`)
    }
  }
})
