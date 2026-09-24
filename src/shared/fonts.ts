/**
 * Imported fonts (`kind: 'font'` assets): the rules both processes share.
 *
 * A font is project state, not machine state. The Shinobi rebuild could only draw in Archivo by
 * installing it into `~/Library/Fonts` — so the `.bay` rendered on that machine and refused on any
 * other. Now the file is imported like any media: main reads its tables and copies it into bay's
 * fonts folder, and the renderer registers it as a `FontFace` from `bay://`, where text items,
 * `.brf` text (variable axes included) and the editor's own measuring all find it. HTML
 * compositions run in a sandbox that may not load `bay://`, so main injects the same face into
 * them as an `@font-face` with a `data:` source — the same bytes, the same descriptors.
 *
 * The descriptors are the whole of "the same face": a variable font registered with one weight
 * would clamp every other weight to it, so `weight` and `stretch` carry the axis ranges.
 */

import type { Asset, FontInfo } from './project'

export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const

export function isFontPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return (FONT_EXTENSIONS as readonly string[]).includes(path.slice(dot + 1).toLowerCase())
}

/** The imported fonts of a project that can be drawn: a readable `kind: 'font'` asset with a file. */
export function importedFonts(assets: readonly Asset[]): (Asset & { font: FontInfo; path: string })[] {
  return assets.filter(
    (asset): asset is Asset & { font: FontInfo; path: string } =>
      asset.kind === 'font' &&
      !asset.error &&
      asset.font !== undefined &&
      asset.path !== null &&
      wellFormedFace(asset.font)
  )
}

/** Every family the project's imported fonts register, once each, in import order. */
export function importedFamilies(assets: readonly Asset[]): string[] {
  return [...new Set(importedFonts(assets).map((asset) => asset.font.family))]
}

/** The `FontFace` descriptors a face registers with — shared by the editor and compositions. */
export function faceDescriptors(info: { weight: string; stretch: string; style: string }): { weight: string; stretch: string; style: string } {
  return { weight: info.weight, stretch: info.stretch, style: info.style }
}

/** The fields an `@font-face` rule is written from — a `FontInfo`, or a composition's copy of one. */
export type FontFaceFields = Pick<FontInfo, 'family' | 'weight' | 'stretch' | 'format'> & { style: string }

const NUMBER = String.raw`\d+(?:\.\d+)?`
const WEIGHT = new RegExp(`^${NUMBER}(?: ${NUMBER})?$`)
const STRETCH = new RegExp(`^${NUMBER}%(?: ${NUMBER}%)?$`)
const FORMATS: readonly string[] = ['truetype', 'opentype', 'woff', 'woff2']

/**
 * True when the descriptors are the shapes main writes. They come from a `.bay` file, which may be
 * someone else's: interpolated unchecked into an `@font-face` rule, a weight of `400; } body {…`
 * would be a stylesheet of the sender's choosing inside a composition window.
 */
export function wellFormedFace(info: FontFaceFields): boolean {
  return (
    typeof info.family === 'string' &&
    info.family.length > 0 &&
    WEIGHT.test(info.weight) &&
    STRETCH.test(info.stretch) &&
    (info.style === 'normal' || info.style === 'italic') &&
    FORMATS.includes(info.format)
  )
}

/** A CSS string literal, for a family name or a URL inside `url("…")`. */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '')}"`
}

/** The `src` value for one face: `url("…") format("…")`. */
export function faceSource(url: string, info: Pick<FontInfo, 'format'>): string {
  return `url(${cssString(url)}) format(${cssString(info.format)})`
}

/**
 * One `@font-face` rule for `info`, loading from `url` — how a composition gets the face. The
 * family is quoted, so a name with spaces or quotes cannot break out of the rule; the descriptors
 * are interpolated as they are, so the caller must have checked them with `wellFormedFace`
 * (`html/font-css.ts` does, and reports the ones it refuses).
 */
export function fontFaceRule(info: FontFaceFields, url: string): string {
  const d = faceDescriptors(info)
  return (
    `@font-face { font-family: ${cssString(info.family)}; src: ${faceSource(url, info)}; ` +
    `font-weight: ${d.weight}; font-stretch: ${d.stretch}; font-style: ${d.style}; font-display: block; }`
  )
}

/** What a tool result says about an imported font. */
export function describeFont(asset: Asset): Record<string, unknown> | null {
  if (asset.kind !== 'font' || !asset.font) return null
  const info = asset.font
  return {
    family: info.family,
    use: `fontFamily "${info.family}" on a text item, font: "${info.family}" in .brf text, or font-family: "${info.family}" in a composition`,
    weight: info.weight,
    stretch: info.stretch,
    style: info.style,
    ...(info.axes.length > 0
      ? { axes: info.axes.map((axis) => ({ tag: axis.tag, min: axis.min, default: axis.default, max: axis.max })) }
      : {}),
    format: info.format
  }
}
