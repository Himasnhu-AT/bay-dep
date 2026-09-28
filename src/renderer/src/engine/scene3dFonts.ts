/**
 * Which font file a `<text3d>` extrudes, decided without loading anything.
 *
 * Extruded text needs glyph *outlines*, which a registered `FontFace` does not expose and a
 * system family does not have in any form bay can reach. So there are exactly two sources:
 *
 * - **Built in: Inter** (OFL-1.1, `@fontsource/inter`, Latin subset, WOFF at 400/700/900). Also
 *   what `"Inter Variable"` — the face bay's own UI ships — maps to, since it is the same design.
 * - **An imported font** (`kind: 'font'`): its file is fetched over `bay://` and read with
 *   opentype.js. TTF, OTF and WOFF read; WOFF2 does not (opentype.js has no Brotli), and a
 *   variable font extrudes its default instance.
 *
 * Anything else is refused by name, listing what would work — never drawn in a stand-in face,
 * which is the fault with no visual cue. Pure, so `write_brf`'s check and the renderer agree.
 */

import type { BrfDocument, Layer } from '@shared/brf'
import { BUILTIN_3D_FONT } from '@shared/scene3d'

export interface FontFile {
  family: string
  /** A `font-weight` descriptor: "700", or "100 900" for a variable font's range. */
  weight: string
  style: string
  format: 'truetype' | 'opentype' | 'woff' | 'woff2'
  url: string
}

export const BUILTIN_WEIGHTS = [400, 700, 900] as const
export type BuiltinWeight = (typeof BUILTIN_WEIGHTS)[number]

export type Text3dFont =
  | { kind: 'builtin'; weight: BuiltinWeight; key: string }
  | { kind: 'file'; url: string; key: string }
  | { error: string }

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2')

function weightRange(descriptor: string): [number, number] {
  const [a, b] = descriptor.trim().split(/\s+/).map(Number)
  const lo = Number.isFinite(a) ? a! : 400
  return [lo, Number.isFinite(b) ? b! : lo]
}

/** How far `weight` is from a face: 0 inside a variable face's range. */
function distance(weight: number, descriptor: string): number {
  const [lo, hi] = weightRange(descriptor)
  return weight < lo ? lo - weight : weight > hi ? weight - hi : 0
}

export function resolveText3dFont(family: string | null, weight: number, files: readonly FontFile[]): Text3dFont {
  const wanted = family === null ? null : unquote(family.split(',')[0] ?? '')
  const lower = wanted?.toLowerCase() ?? null
  // An imported family wins over the built-in one of the same name: the project asked for it.
  const faces = lower === null ? [] : files.filter((f) => f.family.toLowerCase() === lower && f.style !== 'italic')
  const usable = faces.filter((f) => f.format !== 'woff2')
  if (usable.length > 0) {
    const best = [...usable].sort((a, b) => distance(weight, a.weight) - distance(weight, b.weight))[0]!
    return { kind: 'file', url: best.url, key: `file:${best.url}` }
  }
  if (faces.length > 0) {
    return { error: `font "${wanted}" is imported as WOFF2, which 3D text cannot read: import its .ttf or .otf (or use "${BUILTIN_3D_FONT}", built in)` }
  }
  if (lower === null || lower === BUILTIN_3D_FONT.toLowerCase() || lower === 'inter variable') {
    const nearest = [...BUILTIN_WEIGHTS].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0]!
    return { kind: 'builtin', weight: nearest, key: `builtin:${nearest}` }
  }
  const imported = [...new Set(files.filter((f) => f.format !== 'woff2').map((f) => f.family))]
  return {
    error:
      `font "${wanted}" is not a font 3D text can extrude. <text3d> reads the outlines of an imported font ` +
      `(import_media a .ttf/.otf/.woff; use its family) or "${BUILTIN_3D_FONT}" (built in)` +
      (imported.length > 0 ? `. Imported: ${imported.map((f) => `"${f}"`).join(', ')}` : '. This project has no imported fonts')
  }
}

/** Every distinct (font, weight) the `<text3d>`s in `docs` ask for, for `write_brf` to check. */
export function text3dFontRequests(docs: readonly BrfDocument[]): { font: string | null; weight: number }[] {
  const seen = new Map<string, { font: string | null; weight: number }>()
  const walk = (layers: readonly Layer[]): void => {
    for (const layer of layers) {
      if (layer.type === 'group') walk(layer.layers)
      else if (layer.type === 'scene3d') {
        for (const o of layer.objects) {
          if (o.type !== 'text3d') continue
          const font = o.font ?? null
          const weight = o.weight ?? 700
          seen.set(`${font}|${weight}`, { font, weight })
        }
      }
    }
  }
  for (const doc of docs) walk(doc.layers)
  return [...seen.values()]
}
