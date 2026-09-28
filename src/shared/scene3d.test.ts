import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBrf, parseBrf, type DrawOp } from './brf'
import { loadBrf, renderBrf } from './brf-code'
import { estimateVertices, SCENE3D_LIMITS, text3dGeometryKey, textUnit, type Scene3dFrame } from './scene3d'

/** A document holding one scene3d layer with `fields` merged over a legal one. */
const doc = (fields: Record<string, unknown> = {}, objects: unknown[] = [{ type: 'text3d', text: 'SOC 2' }]) => ({
  brf: 1,
  duration: 2,
  layers: [{ type: 'scene3d', x: '50%', y: '50%', w: '100%', h: '100%', objects, ...fields }]
})

const faults = (input: unknown): string[] => {
  const parsed = parseBrf(input)
  return parsed.ok ? [] : parsed.faults.map((f) => `${f.at}: ${f.message}`)
}

test('a legal scene3d parses — the positive control every refusal below is paired with', () => {
  assert.deepEqual(faults(doc()), [])
  assert.deepEqual(
    faults(
      doc(
        { camera: { position: [0, 1, 12], lookAt: [0, 0, 0], fov: 38, roll: -4 }, fog: { near: 8, far: 30, mode: 'fade' }, background: 'transparent' },
        [
          { type: 'light3d', kind: 'directional', position: [4, 6, 8], intensity: 2 },
          { type: 'text3d', text: 'SOC 2', size: 1.8, depth: 0.5, bevel: 0.03, color: '#E9EDF6', metalness: 0.5, roughness: 0.3, position: [0, 1, 0], rotation: [0, 10, 0] },
          { type: 'box3d', size: [1, 2, 3], color: '#7CF2C4' },
          { type: 'plane3d', size: [10, 4], opacity: 0.5 }
        ]
      )
    ),
    []
  )
})

test('every way to get a scene3d wrong is named at its path, with what to write instead', () => {
  const cases: [unknown, RegExp][] = [
    [doc({ camera: { positon: [0, 0, 5] } }), /layers\[0\]\.camera\.positon: a camera has no "positon" — did you mean "position"\?/],
    [doc({ camera: { position: [0, 0] } }), /layers\[0\]\.camera\.position: must be where the camera is: 3 numbers/],
    [doc({ camera: { fov: 400 } }), /camera\.fov: must be the vertical field of view in degrees, a number from 1 to 170/],
    [doc({ camera: { position: [0, 0, 0], lookAt: [0, 0, 0] } }), /camera\.lookAt: is where the camera is, so it looks nowhere/],
    [doc({ fog: { near: 10, far: 5 } }), /fog\.far: must be the distance where fog is total, beyond near/],
    [doc({ fog: { near: 1, far: 5, mode: 'mist' } }), /fog\.mode: must be "fade" .* or "tint"/],
    [doc({ background: 'blue-ish' }), /layers\[0\]\.background: "blue-ish" is not a colour/],
    [doc({}, [{ type: 'text3d', text: 'x', dpeth: 1 }]), /objects\[0\]\.dpeth: a text3d has no "dpeth" — did you mean "depth"\?/],
    [doc({}, [{ type: 'rect', w: 1, h: 1 }]), /objects\[0\]\.type: must be one of text3d, box3d, plane3d, light3d — 2D elements go outside/],
    [doc({}, [{ type: 'light3d', kind: 'spot' }]), /objects\[0\]\.kind: a light is type="ambient", "directional" or "point"/],
    [doc({}, [{ type: 'text3d', text: 'x', curveSegments: 99 }]), /curveSegments: must be a whole number from 1 to 24/],
    [doc({}, [{ type: 'text3d', text: 'x'.repeat(201) }]), /objects\[0\]\.text: is 201 characters; 3D text takes at most 200/],
    [doc({}, [{ type: 'text3d', text: '$title' }]), /objects\[0\]\.text: refers to \$title, which "vars" does not declare/],
    [doc({}, [{ type: 'box3d', size: [1, -2, 1] }]), /objects\[0\]\.size: must be \[width, height, depth\]: 3 numbers above 0/],
    [doc({}, [{ type: 'text3d', text: 'x', metalness: 2 }]), /metalness: must be how metallic it is, a number from 0 to 1/],
    [{ brf: 1, duration: 1, layers: [{ type: 'scene3d', x: 0, y: 0, objects: [] }] }, /layers\[0\]: a scene3d needs "w" and "h"/]
  ]
  for (const [input, pattern] of cases) {
    const found = faults(input)
    assert.ok(found.some((f) => pattern.test(f)), `${JSON.stringify(input)}\n→ ${found.join('\n')}`)
  }
})

test('the caps are checked before any geometry: over-budget text is refused with what to lower', () => {
  const meshes = Array.from({ length: SCENE3D_LIMITS.meshes + 1 }, () => ({ type: 'box3d' }))
  assert.ok(faults(doc({}, meshes)).some((f) => /holds 65 meshes; a scene3d takes at most 64/.test(f)))
  assert.deepEqual(faults(doc({}, meshes.slice(1))), [], 'the positive control: 64 meshes is allowed')

  const heavy = Array.from({ length: 4 }, () => ({ type: 'text3d', text: 'x'.repeat(200), curveSegments: 24, bevel: 0.1 }))
  const refused = faults(doc({}, heavy))
  assert.ok(refused.some((f) => /would build about \d+k vertices, over the 2M a scene may: shorten the text, lower curveSegments/.test(f)), refused.join('\n'))
  assert.deepEqual(faults(doc({}, [{ type: 'text3d', text: 'x'.repeat(200) }])), [], 'the positive control: a long title at defaults fits')
  assert.ok(estimateVertices(200, 24, true) > estimateVertices(200, 8, false), 'the estimate grows with what it counts')
})

const FLY = `
import { interpolate } from 'bay'
export default ({ t }) => (
  <scene duration={2}>
    <scene3d x="50%" y="50%" width="100%" height="100%"
      camera={{ position: [0, 0, interpolate(t, [0, 1], [20, 4])], lookAt: [0, 0, 0], fov: 40 }}
      fog={{ color: '#000000', near: 6, far: 30 }}>
      <light3d type="point" position={[0, 2, 6]} intensity={4} />
      <text3d size={1.5} depth={0.4} color="#E9EDF6">SOC 2</text3d>
    </scene3d>
  </scene>
)`

const scene3dOf = (ops: DrawOp[]): Scene3dFrame => {
  const op = ops.find((o) => o.kind === 'scene3d')
  assert.ok(op && op.kind === 'scene3d', 'no scene3d op was emitted')
  return op.scene
}

test('an animated camera: the frame → scene JSON puts the camera somewhere else at frame 30 than at 0', () => {
  const loaded = loadBrf(FLY)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
  const at = (frame: number): Scene3dFrame => {
    const out = renderBrf(loaded.module, { frame, fps: 30, width: 1920, height: 1080, vars: {} })
    assert.ok(out.ok, out.ok ? '' : out.error)
    return scene3dOf(evaluateBrf(out.doc, frame / 30, 1920, 1080))
  }
  const first = at(0)
  const later = at(30)
  assert.deepEqual(first.camera.position, [0, 0, 20])
  assert.deepEqual(later.camera.position, [0, 0, 4])
  // What does not animate holds still, so the change is the camera's alone.
  assert.deepEqual(first.objects, later.objects)

  // JSX resolved to the document: width/height → w/h, children → objects, <light3d type> → kind.
  const out = renderBrf(loaded.module, { frame: 0, fps: 30, width: 1920, height: 1080, vars: {} })
  assert.ok(out.ok)
  const layer = out.doc.layers[0] as unknown as Record<string, unknown>
  assert.equal(layer.w, '100%')
  assert.equal(layer.width, undefined)
  assert.deepEqual((layer.objects as Record<string, unknown>[]).map((o) => [o.type, o.kind ?? o.text]), [['light3d', 'point'], ['text3d', 'SOC 2']])
  // Fog over a transparent layer defaults to fading out, not tinting (the navy-letters trap).
  assert.equal(first.fog?.mode, 'fade')
  assert.equal(first.defaultLights, false)
})

test('a scene with no light gets the default pair, and says so', () => {
  const parsed = parseBrf(doc())
  assert.ok(parsed.ok)
  const scene = scene3dOf(evaluateBrf(parsed.doc, 0, 100, 100))
  assert.equal(scene.defaultLights, true)
  assert.deepEqual(scene.objects.filter((o) => o.type === 'light3d').map((o) => o.type === 'light3d' && o.kind), ['ambient', 'directional'])
})

test('3D elements are refused outside <scene3d>, and 2D ones inside it', () => {
  const run = (source: string): string => {
    const loaded = loadBrf(source)
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
    const out = renderBrf(loaded.module, { frame: 0, fps: 30, width: 100, height: 100, vars: {} })
    return out.ok ? '' : out.error
  }
  assert.match(run('export default () => <scene duration={1}><text3d>Hi</text3d></scene>'), /<text3d> belongs inside a <scene3d/)
  assert.match(run('export default () => <scene duration={1}><scene3d w={10} h={10}><rect w={1} h={1} fill="#fff" /></scene3d></scene>'), /<rect> cannot go inside <scene3d>/)
  assert.match(run('export default () => <scene duration={1}><scene3d width={10} w={10} h={10} /></scene>'), /has both width and w/)
  assert.equal(run('export default () => <scene duration={1}><scene3d w={10} h={10}><text3d>Hi</text3d></scene3d></scene>'), '', 'the positive control')
})

test('the geometry key changes with shape and nothing else: size and depth are a scale, not a shape', () => {
  const base: { text: string; size: number; depth: number; bevel: number; curveSegments: number; align: 'left' | 'center' | 'right'; lineHeight: number } = { text: 'SOC 2', size: 1, depth: 0.2, bevel: 0, curveSegments: 8, align: 'center', lineHeight: 1.2 }
  const keyOf = (o: typeof base, font = 'builtin:700'): string => text3dGeometryKey(textUnit(o).shape, font)
  const key = keyOf(base)
  // What moves every frame of a fly-through must not rebuild geometry, size and depth included,
  // which the mesh's scale carries (a title that grows would otherwise re-extrude every frame)...
  for (const change of [{ size: 2.5 }, { depth: 0.9 }, { size: 0.3, depth: 4 }]) {
    assert.equal(keyOf({ ...base, ...change }), key, JSON.stringify(change))
  }
  assert.deepEqual(textUnit({ ...base, size: 2.5, depth: 0.9 }).scale, [2.5, 2.5, 0.9], 'and the scale is what sizes it')
  // ...and everything that changes the shape must.
  for (const change of [{ text: 'SOC 3' }, { bevel: 0.01 }, { curveSegments: 9 }, { align: 'left' as const }, { lineHeight: 1 }, { depth: 0 }]) {
    assert.notEqual(keyOf({ ...base, ...change }), key, JSON.stringify(change))
  }
  assert.notEqual(keyOf(base, 'builtin:900'), key, 'another face is another shape')
  // A bevel is absolute, so with one, size and depth are shape too (the guide says animating it is costly).
  const bevelled = { ...base, bevel: 0.02 }
  assert.notEqual(keyOf({ ...bevelled, size: 2 }), keyOf(bevelled))
  assert.notEqual(keyOf({ ...bevelled, depth: 0.4 }), keyOf(bevelled))
})
