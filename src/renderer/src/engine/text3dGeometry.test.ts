import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, type Font } from 'opentype.js/dist/opentype.mjs'
import { estimateVertices, SCENE3D_LIMITS, textUnit, type ResolvedObject3d } from '@shared/scene3d'
import { buildTextGeometry, GeometryCache } from './text3dGeometry'
import { resolveText3dFont, type FontFile } from './scene3dFonts'

/** The built-in face, the same file `scene3d.ts` inlines. */
function inter(weight: 400 | 700 | 900): Font {
  const bytes = readFileSync(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`)
  return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

type TextObject = Extract<ResolvedObject3d, { type: 'text3d' }>
const text = (over: Partial<TextObject> = {}): TextObject => ({
  type: 'text3d',
  text: 'SOC 2',
  font: null,
  weight: 700,
  size: 1,
  depth: 0.2,
  bevel: 0,
  curveSegments: 8,
  align: 'center',
  lineHeight: 1.2,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  color: 'rgba(255,255,255,1)',
  metalness: 0.1,
  roughness: 0.45,
  emissive: 'rgba(0,0,0,1)',
  emissiveIntensity: 1,
  opacity: 1,
  ...over
})

/** What `buildTextGeometry` is handed in the renderer: the text's unit shape. */
const shape = (over: Partial<TextObject> = {}) => textUnit(text(over)).shape

const vertices = (g: { getAttribute(name: string): { count: number } | undefined }): number => g.getAttribute('position')?.count ?? 0

test('Inter extrudes to real geometry, centred, and lands at the size and depth asked once scaled', () => {
  // Built at unit size and depth; the mesh's scale (the cache's `scale`) makes it what was asked.
  const cache = new GeometryCache()
  const got = cache.text(inter(700), 'builtin:700', text({ size: 2, depth: 0.5 }))
  assert.ok('geometry' in got, 'error' in got ? got.error : '')
  const g = got.geometry
  assert.ok(vertices(g) > 1000, `only ${vertices(g)} vertices for "SOC 2"`)
  g.computeBoundingBox()
  const box = g.boundingBox!
  const [sx, sy, sz] = got.scale
  assert.ok(Math.abs(box.min.x + box.max.x) < 0.05, `not centred in x: ${box.min.x}..${box.max.x}`)
  assert.ok(Math.abs(box.min.y + box.max.y) < 1e-6, `not centred in y: ${box.min.y}..${box.max.y}`)
  assert.ok(Math.abs((box.max.z - box.min.z) * sz - 0.5) < 1e-6, `depth ${(box.max.z - box.min.z) * sz}, asked 0.5`)
  // About five letters of cap height 0.73 em at size 2: wide, not a sliver and not a slab.
  assert.ok((box.max.x - box.min.x) * sx > 4 && (box.max.x - box.min.x) * sx < 8, `width ${(box.max.x - box.min.x) * sx}`)
  assert.ok((box.max.y - box.min.y) * sy > 1.2 && (box.max.y - box.min.y) * sy < 1.6, `height ${(box.max.y - box.min.y) * sy}`)
})

test('a bevel lands at its absolute size and thickness after the non-uniform scale', () => {
  const bevel = 0.04
  const cache = new GeometryCache()
  const flat = cache.text(inter(900), 'builtin:900', text({ size: 2, depth: 0.5 }))
  const bevelled = cache.text(inter(900), 'builtin:900', text({ size: 2, depth: 0.5, bevel }))
  assert.ok('geometry' in flat && 'geometry' in bevelled)
  const depthOf = (g: typeof flat & { geometry: unknown }, z: number): number => {
    const geometry = (g as { geometry: import('three').BufferGeometry }).geometry
    geometry.computeBoundingBox()
    return (geometry.boundingBox!.max.z - geometry.boundingBox!.min.z) * z
  }
  // ExtrudeGeometry adds the bevel's thickness on both faces.
  assert.ok(Math.abs(depthOf(bevelled, bevelled.scale[2]) - (0.5 + 2 * bevel)) < 1e-6, `bevelled depth ${depthOf(bevelled, bevelled.scale[2])}`)
  assert.ok(Math.abs(depthOf(flat, flat.scale[2]) - 0.5) < 1e-6)
})

/** The area of the front cap: every triangle lying in the geometry's nearest z plane. */
function frontArea(g: { getAttribute(name: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } | undefined }): number {
  const p = g.getAttribute('position')!
  let front = -Infinity
  for (let i = 0; i < p.count; i++) front = Math.max(front, p.getZ(i))
  let area = 0
  for (let i = 0; i + 2 < p.count; i += 3) {
    if (![i, i + 1, i + 2].every((k) => Math.abs(p.getZ(k) - front) < 1e-9)) continue
    const ax = p.getX(i + 1) - p.getX(i)
    const ay = p.getY(i + 1) - p.getY(i)
    const bx = p.getX(i + 2) - p.getX(i)
    const by = p.getY(i + 2) - p.getY(i)
    area += Math.abs(ax * by - ay * bx) / 2
  }
  return area
}

test('holes stay holes: the face of an O is a ring, not a disc', () => {
  // Wrong winding shows up as the counter filled (a disc: the ellipse's whole area) or extruded
  // as a second solid over it (more than the ellipse). A ring is well under either.
  const built = buildTextGeometry(inter(700), shape({ text: 'O' }))
  assert.ok('geometry' in built)
  built.geometry.computeBoundingBox()
  const box = built.geometry.boundingBox!
  const ellipse = (Math.PI / 4) * (box.max.x - box.min.x) * (box.max.y - box.min.y)
  const ring = frontArea(built.geometry)
  assert.ok(ring > 0.2 * ellipse && ring < 0.75 * ellipse, `front ${ring.toFixed(3)} of an ellipse ${ellipse.toFixed(3)}`)
})

test('the pre-geometry vertex estimate stays above what Inter really builds', () => {
  // The caps in @shared/scene3d are checked against the estimate before any font is read, so it
  // must not undercount the real thing — or the budget is a number and not a bound.
  const cases: Partial<TextObject>[] = [
    { text: 'SOC 2 in minutes' },
    { text: 'WWWMMM@@@&&&', curveSegments: 24 },
    { text: 'Bevelled 88', bevel: 0.03 },
    { text: '@&%$#8BQRSgw', curveSegments: 16, bevel: 0.05 }
  ]
  for (const c of cases) {
    const o = text(c)
    const built = buildTextGeometry(inter(900), textUnit(o).shape)
    assert.ok('geometry' in built)
    const real = vertices(built.geometry)
    const estimate = estimateVertices(o.text.length, o.curveSegments, o.bevel > 0)
    assert.ok(estimate >= real, `${JSON.stringify(c)}: estimated ${estimate}, built ${real}`)
    assert.ok(estimate < real * 20, `${JSON.stringify(c)}: estimate ${estimate} is too loose to be a useful budget (built ${real})`)
  }
})

test('what was built answers to the budget too, since the estimate is only calibrated on Inter', () => {
  const o = shape({ text: 'SOC 2', bevel: 0.03 })
  const built = buildTextGeometry(inter(900), o)
  assert.ok('geometry' in built)
  const real = vertices(built.geometry)
  const over = buildTextGeometry(inter(900), o, real - 1)
  assert.ok('error' in over && /built \d+k vertices in this font, over the [\d,]+ a scene may: shorten the text/.test(over.error), JSON.stringify(over))
  assert.ok('geometry' in buildTextGeometry(inter(900), o, real), 'the positive control: exactly at the budget builds')
})

test('a character the font lacks is refused by name, not extruded as a box', () => {
  const built = buildTextGeometry(inter(400), shape({ text: 'Go → now' }))
  assert.ok('error' in built)
  assert.match(built.error, /no glyph for "→": use another font, or leave it out/)
  assert.ok('geometry' in buildTextGeometry(inter(400), shape({ text: 'Go -> now' })), 'the positive control')
})

test('the cache builds each shape once: a moved, resized or deepened text reuses it, new words do not', () => {
  const font = inter(700)
  const cache = new GeometryCache(3)
  const a = cache.text(font, 'builtin:700', text())
  assert.ok('geometry' in a)
  // Everything a fly-through animates, size and depth included, is a transform: no rebuild.
  for (const over of [{ position: [4, 5, 6] as [number, number, number], color: 'rgba(255,0,0,1)', opacity: 0.2 }, { size: 3.7 }, { depth: 0.9 }]) {
    const again = cache.text(font, 'builtin:700', text(over))
    assert.ok('geometry' in again)
    assert.equal(again.geometry, a.geometry, `${JSON.stringify(over)} re-extruded the text`)
  }
  const other = cache.text(font, 'builtin:700', text({ text: 'SOC 3' }))
  assert.ok('geometry' in other)
  assert.notEqual(other.geometry, a.geometry)
  assert.notEqual(cache.text(font, 'builtin:900', text()), a, 'another face is another entry')
  assert.equal(cache.size, 3)

  // Past the cap the oldest goes, and its GPU buffers with it.
  let disposed = false
  a.geometry.addEventListener('dispose', () => (disposed = true))
  cache.text(font, 'builtin:700', text({ text: 'new' }))
  assert.equal(cache.size, 3)
  assert.ok(disposed, 'the evicted geometry was not disposed')
})

test('boxes and planes are one unit geometry each, sized by scale', () => {
  const cache = new GeometryCache()
  const a = cache.box([1, 2, 3])
  const b = cache.box([4, 0.5, 9])
  assert.equal(a.geometry, b.geometry, 'an animated box size must not rebuild geometry')
  assert.deepEqual(b.scale, [4, 0.5, 9])
  const p = cache.plane([10, 4])
  assert.equal(p.geometry, cache.plane([2, 2]).geometry)
  assert.deepEqual(p.scale, [10, 4, 1])
  a.geometry.computeBoundingBox()
  assert.deepEqual(a.geometry.boundingBox!.max.toArray(), [0.5, 0.5, 0.5], 'unit box: the scale is the size')
})

test('the cache holds at least every mesh one scene may draw, so a frame never evicts its own geometry', () => {
  assert.ok(new GeometryCache().cap >= SCENE3D_LIMITS.meshes, `cap ${new GeometryCache().cap} < ${SCENE3D_LIMITS.meshes} meshes`)
})

test('font choice: built in, imported, WOFF2 and unknown each say what they are', () => {
  const files: FontFile[] = [
    { family: 'Archivo', weight: '100 900', style: 'normal', format: 'truetype', url: 'bay://media/a' },
    { family: 'Brand', weight: '400', style: 'normal', format: 'woff2', url: 'bay://media/b' }
  ]
  assert.deepEqual(resolveText3dFont(null, 850, files), { kind: 'builtin', weight: 900, key: 'builtin:900' })
  assert.deepEqual(resolveText3dFont('Inter Variable', 450, files), { kind: 'builtin', weight: 400, key: 'builtin:400' })
  assert.deepEqual(resolveText3dFont('"Archivo", sans-serif', 700, files), { kind: 'file', url: 'bay://media/a', key: 'file:bay://media/a' })
  const woff2 = resolveText3dFont('Brand', 400, files)
  assert.ok('error' in woff2 && /imported as WOFF2, which 3D text cannot read: import its \.ttf or \.otf/.test(woff2.error))
  const unknown = resolveText3dFont('Helvetica', 400, files)
  assert.ok('error' in unknown && /"Helvetica" is not a font 3D text can extrude.*Imported: "Archivo"/.test(unknown.error), JSON.stringify(unknown))
})
