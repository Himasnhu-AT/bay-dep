import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, loadBrf, probeBrf, renderBrf, spring, type BrfModule } from './brf-code'
import type { BrfDocument, Layer } from './brf'

const load = (source: string): BrfModule => {
  const loaded = loadBrf(source)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
  return loaded.module
}
const frame = (mod: BrfModule, n: number, vars = mod.vars): BrfDocument => {
  const out = renderBrf(mod, { frame: n, fps: 30, width: 1920, height: 1080, vars })
  assert.ok(out.ok, out.ok ? '' : out.error)
  return out.doc
}
const failure = (source: string, n = 0): string => {
  const loaded = loadBrf(source)
  if (!loaded.ok) return loaded.error
  const out = renderBrf(loaded.module, { frame: n, fps: 30, width: 1920, height: 1080, vars: loaded.module.vars })
  assert.ok(!out.ok, 'expected a failure')
  return out.error
}
const find = (doc: BrfDocument, type: Layer['type']) => doc.layers.find((l) => l.type === type) as Record<string, unknown> | undefined

/** The example the format was asked for, verbatim but for its import. */
const ASKED_FOR = `
import { interpolate, spring } from 'bay'
export default ({ t }) => (
  <scene duration={4}>
    <rect x="50%" y="50%" w="60%" h={8}
      sx={spring(t, { delay: 0.2 })} fill="#11D1A0" />
    <text x="50%" y="45%" size="8%"
      opacity={interpolate(t, [0, 0.4], [0, 1])}>
      {\`\${Math.round(interpolate(t,[0,2],[0,3200]))} users\`}
    </text>
  </scene>
)`

test('the example the format was designed around compiles and draws, and moves over time', () => {
  const mod = load(ASKED_FOR)
  const start = frame(mod, 0)
  const later = frame(mod, 60)
  assert.equal(start.duration, 4)
  assert.equal(find(start, 'text')!.text, '0 users')
  assert.equal(find(later, 'text')!.text, '3200 users')
  assert.equal(find(start, 'text')!.opacity, 0)
  assert.equal(find(later, 'text')!.opacity, 1)
  assert.equal(find(start, 'rect')!.sx, 0, 'the spring has not been released at t=0')
  assert.ok(Math.abs((find(later, 'rect')!.sx as number) - 1) < 0.05, 'and has settled by t=2')
})

test('Remotion-style code works: useCurrentFrame, useVideoConfig, the object spring, <Sequence>', () => {
  const mod = load(`
    import { useCurrentFrame, useVideoConfig, spring, interpolate, Sequence } from 'remotion'
    const Title = ({ label }) => {
      const frame = useCurrentFrame()
      const { fps } = useVideoConfig()
      const s = spring({ frame, fps, config: { damping: 200 } })
      return <text x="50%" y="50%" scale={s} opacity={interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })}>{label}</text>
    }
    export default () => (
      <scene duration={3}>
        <Sequence from={30} durationInFrames={30}><Title label="Second" /></Sequence>
        <Title label="First" />
      </scene>
    )`)
  const texts = (n: number) => frame(mod, n).layers.map((l) => (l as { text: string }).text)
  assert.deepEqual(texts(0), ['First'])
  assert.deepEqual(texts(30), ['Second', 'First'])
  assert.deepEqual(texts(60), ['First'], 'the sequence has ended')
  // Inside the sequence the frame starts again at 0, so its entrance plays from the beginning.
  assert.equal(frame(mod, 30).layers[0]!.opacity, 0)
  assert.equal(frame(mod, 35).layers[0]!.opacity, 0.5)
})

test("bay's interpolate clamps; Remotion's extends, as Remotion's does", async () => {
  assert.equal(interpolate(2, [0, 1], [0, 10]), 10)
  const { REMOTION_MODULE } = await import('./brf-code')
  assert.equal(REMOTION_MODULE.interpolate(2, [0, 1], [0, 10]), 20)
  assert.equal(REMOTION_MODULE.interpolate(2, [0, 1], [0, 10], { extrapolateRight: 'clamp' }), 10)
  assert.equal(interpolate(0.5, [0, 1], [0, 10], { easing: 'inQuad' }), 2.5)
})

test('both spring forms are the same physics, and an underdamped one overshoots then settles', () => {
  assert.equal(spring(0), 0)
  assert.ok(Math.abs(spring(3) - 1) < 1e-3)
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => spring(i / 30)))
  assert.ok(peak > 1.05, `default config overshoots (${peak})`)
  assert.ok(Math.abs(spring(0.5, { delay: 0.2 }) - spring({ frame: 15, fps: 30, delay: 6 })) < 1e-12)
  assert.ok(spring(10, { damping: 200 }) <= 1.0000001, 'heavily damped does not overshoot')
  // Remotion treats a damping ratio >= 1 as critically damped, so damping: 200 settles in about
  // half a second: 1 - e^-5 (1 + 5) at 0.5s. The overdamped curve would be ~0.22 there.
  assert.ok(Math.abs(spring(0.5, { damping: 200 }) - (1 - Math.exp(-5) * 6)) < 1e-12)
})

test('components, fragments, loops and arrays all resolve to layers', () => {
  const mod = load(`
    const Dot = ({ x }) => <ellipse x={x} y="50%" w={20} h={20} fill="#fff" />
    export default () => (
      <scene duration={1}>
        <>
          {[10, 20, 30].map((x) => <Dot key={x} x={x} />)}
        </>
        <group x={5} layers-ignored="no">
          <rect w={1} h={1} fill="#000" />
        </group>
        {false}
        {null}
      </scene>
    )`.replace(' layers-ignored="no"', ''))
  const doc = frame(mod, 0)
  assert.deepEqual(doc.layers.map((l) => l.type), ['ellipse', 'ellipse', 'ellipse', 'group'])
  assert.equal((doc.layers[1] as { x: number }).x, 20)
  assert.equal((doc.layers[3] as { layers: Layer[] }).layers.length, 1)
})

test('vars: the module declares defaults, a placement overrides them', () => {
  const mod = load(`
    export const vars = { title: 'Hello', accent: '#11D1A0' }
    export default ({ vars }) => <scene duration={2}><text fill={vars.accent}>{vars.title.toUpperCase()}</text></scene>`)
  assert.deepEqual(mod.vars, { title: 'Hello', accent: '#11D1A0' })
  assert.equal(find(frame(mod, 0), 'text')!.text, 'HELLO')
  assert.equal(find(frame(mod, 0, { ...mod.vars, title: 'Bye' }), 'text')!.text, 'BYE')
  const probed = probeBrf(mod, 30, 1920, 1080)
  assert.ok(probed.ok)
  assert.deepEqual(probed.meta, { duration: 2, vars: { title: 'Hello', accent: '#11D1A0' } })
})

test('a frame is deterministic: Math.random is seeded by the frame, and restored afterwards', () => {
  const mod = load(`export default () => <scene duration={1}><rect w={Math.random() * 100} h={1} fill="#fff" x={Date.now()} /></scene>`)
  const w = (n: number) => find(frame(mod, n), 'rect')!.w
  assert.equal(w(5), w(5))
  assert.notEqual(w(5), w(6))
  assert.equal(find(frame(mod, 5), 'rect')!.x, 0, 'Date.now() is the start of the document')
  const before = Math.random
  frame(mod, 1)
  assert.equal(Math.random, before)
})

test('a variable called h or Fragment does not break the elements beside it', () => {
  // The bar-chart example named a bar's height \`h\`, which shadowed a JSX factory of that name.
  const mod = load(`export default ({ height }) => { const h = height / 2; const Fragment = 1; return <scene duration={1}><rect w={h} h={h} fill="#fff" /></scene> }`)
  assert.equal(find(frame(mod, 0), 'rect')!.w, 540)
})

test('an empty frame is allowed — nothing is on screen yet', () => {
  const mod = load(`import { Sequence } from 'bay'
    export default () => <scene duration={2}><Sequence from={30}><rect w={1} h={1} fill="#fff" /></Sequence></scene>`)
  assert.deepEqual(frame(mod, 0).layers, [])
})

test('every way to get it wrong says where and what to do', () => {
  const cases: [string, RegExp][] = [
    ['export default () => <scene duration={1}><rect w={1} h={1} fill="#fff" /></scene', /does not compile/],
    ['import fs from "fs"\nexport default () => <scene duration={fs.x} />', /cannot import "fs": a \.brf can import only from 'bay' or 'remotion'/],
    ['export default () => { import("https://example.com/x.js"); return <scene duration={1} /> }', /uses import\(\): a \.brf cannot load code at run time/],
    ['export const x = 1', /needs a default export/],
    ['export default () => <rect w={1} h={1} fill="#fff" />', /must return <scene duration=\{seconds\}>/],
    ['export default () => <scene><rect w={1} h={1} fill="#fff" /></scene>', /<scene> needs duration=\{seconds\}/],
    ['export default () => <scene duration={1}><div>hi</div></scene>', /<div> is not a bay element.*DOM elements are not drawn/],
    ['export default () => <scene duration={1}>hello</scene>', /text "hello" must be inside <text>/],
    ['export default () => <scene duration={1}><rect w={1} h={1} fill="#fff" opactiy={1} /></scene>', /frame 0: layers\[0\]\.opactiy: .*did you mean "opacity"/],
    ['export default ({ vars }) => <scene duration={1}><text>{vars.missing.name}</text></scene>', /frame 0 \(line 1:\d+\): .*Cannot read properties of undefined/],
    ['export const vars = { when: new Date(0) }\nexport default () => <scene duration={1} />', /vars\.when must be a string, number or boolean/]
  ]
  for (const [source, pattern] of cases) assert.match(failure(source), pattern, source)
})

test('a runtime error names the frame it happened on', () => {
  const source = `export default ({ frame }) => {\n  if (frame === 12) throw new Error('boom')\n  return <scene duration={1} />\n}`
  assert.match(failure(source, 12), /^frame 12 \(line 2:\d+\): boom$/)
  const mod = load(source)
  assert.ok(renderBrf(mod, { frame: 11, fps: 30, width: 10, height: 10, vars: {} }).ok, 'the positive control: frame 11 is fine')
})

/** Every frame of `source`, as write_brf checks it but exhaustively. */
function runsEveryFrame(source: string, label: string): void {
  const loaded = loadBrf(source)
  assert.ok(loaded.ok, `${label}: ${loaded.ok ? '' : loaded.error}`)
  const meta = probeBrf(loaded.module, 30, 1080, 1920)
  assert.ok(meta.ok, `${label}: ${meta.ok ? '' : meta.error}`)
  for (let n = 0; n < Math.ceil(meta.meta.duration * 30); n++) {
    const out = renderBrf(loaded.module, { frame: n, fps: 30, width: 1080, height: 1920, vars: loaded.module.vars })
    assert.ok(out.ok, `${label}, frame ${n}: ${out.ok ? '' : out.error}`)
  }
}

test('every example module in bay://guide/brf compiles and runs on every frame', async () => {
  // The guide is what an agent copies from; an example that fails teaches the failure.
  const { readFileSync } = await import('node:fs')
  const guide = readFileSync('src/main/mcp/docs/brf.md', 'utf8')
  const blocks = [...guide.matchAll(/```tsx\n([\s\S]*?)```/g)].map((m) => m[1]!)
  assert.ok(blocks.length >= 7, `only ${blocks.length} examples found — is the fence still \`\`\`tsx?`)
  blocks.forEach((block, i) => runsEveryFrame(block, `guide example ${i + 1}`))
})

test('every write_brf in the worked-edits guide carries a module that runs', async () => {
  const { EXAMPLES, isCall } = await import('./guides')
  const sources = EXAMPLES.flatMap((e) => e.steps)
    .filter(isCall)
    .filter((step) => step.tool === 'write_brf')
    .map((step) => step.args.code as string)
  assert.ok(sources.length > 0, 'no write_brf example to check')
  sources.forEach((source, i) => runsEveryFrame(source, `worked edit ${i + 1}`))
})

test('the lower third as a module is a fraction of the HTML template it replaces', async () => {
  const { readFileSync } = await import('node:fs')
  const html = readFileSync('src/main/templates/lower-third.html', 'utf8').length
  const guide = readFileSync('src/main/mcp/docs/brf.md', 'utf8')
  const module = /### Lower third, as components\n\n```tsx\n([\s\S]*?)```/.exec(guide)![1]!
  // Held at under a third — the claim in brf-code.ts — so it cannot quietly stop being true.
  assert.ok(module.length * 3 < html, `.brf ${module.length} chars against HTML ${html}`)
})
