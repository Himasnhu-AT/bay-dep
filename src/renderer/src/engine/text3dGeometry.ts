/**
 * Glyph outlines → extruded three.js geometry, and the cache that keeps it.
 *
 * Why not three's `TextGeometry`/`TTFLoader`: `TextGeometry` wants a typeface JSON, and
 * `TTFLoader` (r186) imports opentype.js **from a CDN** — a network request the editor refuses
 * and a build that would not be self-contained. So the outlines are read here with a bundled
 * opentype.js and fed to `ExtrudeGeometry` directly, which is all `TextGeometry` does anyway.
 *
 * Glyphs are placed one by one with the font's kerning, not shaped: opentype.js 2.0's shaper
 * throws on Inter's `ccmp` lookup (measured: "substitutionType : 62 lookupType: 6 - substFormat:
 * 2 is not yet supported"), and ligatures do not matter for a title. A character the font has no
 * glyph for is refused by name rather than extruded as a `.notdef` box.
 *
 * Pure three.js + opentype.js, no canvas and no GL, so it is tested under Node against the real
 * Inter file.
 */

import { BoxGeometry, BufferGeometry, ExtrudeGeometry, PlaneGeometry, ShapePath, type Shape } from 'three'
import type { Font } from 'opentype.js/dist/opentype.mjs'
import { BEVEL_SEGMENTS, SCENE3D_LIMITS, text3dGeometryKey, type ResolvedObject3d } from '@shared/scene3d'

type TextObject = Extract<ResolvedObject3d, { type: 'text3d' }>

/** Extruded `o.text` in `font`, centred on the origin (horizontally by `align`), or why not. */
export function buildTextGeometry(
  font: Font,
  o: Pick<TextObject, 'text' | 'size' | 'depth' | 'bevel' | 'curveSegments' | 'align' | 'lineHeight'>,
  budget: number = SCENE3D_LIMITS.vertices
): { geometry: BufferGeometry } | { error: string } {
  const scale = o.size / font.unitsPerEm
  const missing = new Set<string>()
  const shapes: Shape[] = []
  o.text.split('\n').forEach((line, row) => {
    const placed: { glyph: ReturnType<Font['charToGlyph']>; x: number }[] = []
    let x = 0
    let previous: ReturnType<Font['charToGlyph']> | null = null
    for (const char of line) {
      const glyph = font.charToGlyph(char)
      if (glyph.index === 0 && char.trim() !== '') missing.add(char)
      if (previous) x += font.getKerningValue(previous, glyph) * scale
      placed.push({ glyph, x })
      x += (glyph.advanceWidth ?? 0) * scale
      previous = glyph
    }
    const offset = o.align === 'left' ? 0 : o.align === 'right' ? -x : -x / 2
    const baseline = -row * o.lineHeight * o.size
    for (const { glyph, x: gx } of placed) {
      // opentype draws y-down; the scene is y-up.
      const commands = glyph.getPath(gx + offset, 0, o.size).commands
      const path = new ShapePath()
      for (const c of commands) {
        const y = (v: number | undefined): number => baseline - (v ?? 0)
        if (c.type === 'M') path.moveTo(c.x ?? 0, y(c.y))
        else if (c.type === 'L') path.lineTo(c.x ?? 0, y(c.y))
        else if (c.type === 'Q') path.quadraticCurveTo(c.x1 ?? 0, y(c.y1), c.x ?? 0, y(c.y))
        else if (c.type === 'C') path.bezierCurveTo(c.x1 ?? 0, y(c.y1), c.x2 ?? 0, y(c.y2), c.x ?? 0, y(c.y))
      }
      // Winding decides holes (nonzero, r186's `toShapes`), so TrueType and CFF outlines both work.
      shapes.push(...path.toShapes())
    }
  })
  if (missing.size > 0) {
    return { error: `the font has no glyph for ${[...missing].map((c) => JSON.stringify(c)).join(', ')}: use another font, or leave ${missing.size === 1 ? 'it' : 'them'} out` }
  }
  if (shapes.length === 0) return { geometry: new BufferGeometry() }
  const geometry = new ExtrudeGeometry(shapes, {
    depth: o.depth,
    curveSegments: o.curveSegments,
    bevelEnabled: o.bevel > 0,
    bevelThickness: o.bevel,
    bevelSize: o.bevel,
    bevelSegments: BEVEL_SEGMENTS
  })
  // The estimate the document was admitted on is calibrated on Inter; an ornate font can build
  // more, so what was actually built answers to the same budget.
  const built = geometry.getAttribute('position').count
  if (built > budget) {
    geometry.dispose()
    return { error: `built ${Math.round(built / 1000)}k vertices in this font, over the ${budget.toLocaleString('en')} a scene may: shorten the text, lower curveSegments, or drop the bevel` }
  }
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  // Centred on its position: vertically on the ink, and through its depth.
  if (box) geometry.translate(0, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2)
  return { geometry }
}

/**
 * Geometry kept across frames. A fly-through changes transforms every frame and shape never, so
 * a text is extruded once per shape (`text3dGeometryKey`) and reused; the oldest entry is
 * disposed past the cap. Each entry is either geometry or the reason it cannot be built, so a bad
 * text is not re-extruded on every frame to fail again.
 */
export class GeometryCache {
  readonly #entries = new Map<string, { geometry: BufferGeometry } | { error: string }>()
  readonly #cap: number

  constructor(cap = 48) {
    this.#cap = cap
  }

  get size(): number {
    return this.#entries.size
  }

  text(font: Font, fontKey: string, o: TextObject): { geometry: BufferGeometry } | { error: string } {
    return this.#get(text3dGeometryKey(o, fontKey), () => buildTextGeometry(font, o))
  }

  box(size: [number, number, number]): BufferGeometry {
    const entry = this.#get(`box:${size.join(',')}`, () => ({ geometry: new BoxGeometry(size[0], size[1], size[2]) }))
    return 'geometry' in entry ? entry.geometry : new BufferGeometry()
  }

  plane(size: [number, number]): BufferGeometry {
    const entry = this.#get(`plane:${size.join(',')}`, () => ({ geometry: new PlaneGeometry(size[0], size[1]) }))
    return 'geometry' in entry ? entry.geometry : new BufferGeometry()
  }

  #get(key: string, build: () => { geometry: BufferGeometry } | { error: string }): { geometry: BufferGeometry } | { error: string } {
    const hit = this.#entries.get(key)
    if (hit) {
      // Most recently used last, so the first key is always the one to evict.
      this.#entries.delete(key)
      this.#entries.set(key, hit)
      return hit
    }
    const built = build()
    this.#entries.set(key, built)
    while (this.#entries.size > this.#cap) {
      const oldest = this.#entries.keys().next().value as string
      const entry = this.#entries.get(oldest)
      if (entry && 'geometry' in entry) entry.geometry.dispose()
      this.#entries.delete(oldest)
    }
    return built
  }

  clear(): void {
    for (const entry of this.#entries.values()) if ('geometry' in entry) entry.geometry.dispose()
    this.#entries.clear()
  }
}
