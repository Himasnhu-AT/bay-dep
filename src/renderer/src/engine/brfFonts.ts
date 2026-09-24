/**
 * Variable-font axes for `.brf` text — `<text variations={{ wdth: 87, wght: 600 }}>`.
 *
 * Canvas 2D has no `font-variation-settings`. Measured in bay's Chromium (2026-09-23) with
 * Archivo[wdth,wght], "Brand Typography" at 48px:
 *
 * - `ctx.fontStretch` works but takes keywords only (condensed = 75%, expanded = 125%) — no 87.
 * - A `FontFace` registered with a `variationSettings` descriptor draws with those settings:
 *   `"wdth" 62` measured 261.9px against 392.2px for the default face, identical to a face with
 *   `stretch: '62%'`. Any axis, any value — including a font's own (`GRAD`).
 *
 * So each distinct (family, settings) gets a face of its own under a synthetic family name, made
 * from the same source the family already has, and the text is drawn in `"<synthetic>", <font>`
 * (the author's list stays behind it for glyphs the face lacks). Where the source comes from:
 *
 * 1. a font the project imported (`importedFonts.ts`) — its own file over `bay://`, so the face
 *    and every axis it declares travel with the project;
 * 2. an `@font-face` rule in the editor's own stylesheets (the fonts bay bundles) — every rule of
 *    the family is cloned, so a font split by `unicode-range` keeps all its ranges;
 * 3. otherwise an installed font, through `local()` — which Chromium matches by full or
 *    PostScript name only (measured: `local("Skia")` failed, `local("Skia-Regular")` loaded).
 *
 * Nothing here reaches the network: a rule's URLs are the editor's own files, and `local()` is
 * the machine's fonts. A face loads asynchronously, so the first frame that needs one is
 * *pending* — exactly like a scene still in the worker — and preview, `preview_frame` and export
 * all wait through the same `settle`/`onReady` the `.brf` runtime already has.
 */

import { DEFAULT_FONT, type BrfDocument, type Layer } from '@shared/brf'
import { importedFonts } from './importedFonts'

export type Variations = Record<string, number>

export interface FaceSource {
  /** A CSS `src` value: `url(…) format(…)` list or `local(…)` list. */
  src: string
  weight?: string
  style?: string
  stretch?: string
  unicodeRange?: string
}

/** What the faces need from the page — injected, so the logic runs under Node. */
export interface FontEnv {
  /** The `@font-face` sources the page has for `family` (matched unquoted, case-insensitively). */
  rulesFor(family: string): FaceSource[]
  /** Every family the page's `@font-face` rules declare — named in the refusal. */
  families(): string[]
  /** Every family the project imported — named in the refusal too, first. */
  importedFamilies?(): string[]
  /** Registers `source` as `family` with `variationSettings`; resolves once usable. */
  load(family: string, source: FaceSource, variationSettings: string): Promise<void>
  /** Unregisters every face of `family`. */
  remove(family: string): void
}

/** `{ wght: 600, wdth: 87 }` → `"wdth" 87, "wght" 600` — tag order, so one setting has one key. */
export function variationSettings(variations: Variations): string {
  return Object.keys(variations)
    .sort()
    .map((tag) => `"${tag}" ${variations[tag]}`)
    .join(', ')
}

/** The first family of a CSS font-family list, unquoted. */
export function firstFamily(list: string): string {
  const first = list.split(',')[0] ?? ''
  return first.trim().replace(/^(['"])(.*)\1$/, '$2')
}

/** `local()` names Chromium might know an installed family by. */
export function localNames(family: string): string[] {
  return [family, `${family} Regular`, `${family.replace(/\s+/g, '')}-Regular`]
}

type Entry = { family: string; state: 'loading' | 'ready' } | { family: string; state: 'failed'; error: string }

/** How many faces stay registered; an animated axis makes one per distinct value. */
export const MAX_FACES = 128

export class VariationFaces {
  readonly #env: FontEnv
  readonly #entries = new Map<string, Entry>()
  readonly #inflight = new Set<Promise<void>>()
  readonly #listeners = new Set<() => void>()
  #next = 0

  constructor(env: FontEnv) {
    this.#env = env
  }

  /**
   * The font list to draw `font` with `variations` in — or that its face is still loading, or why
   * it never will. Never blocks; the first ask starts the load.
   */
  resolve(font: string, variations: Variations): { font: string } | { pending: true } | { error: string } {
    const family = firstFamily(font)
    const settings = variationSettings(variations)
    const key = `${family.toLowerCase()}|${settings}`
    let entry = this.#entries.get(key)
    if (!entry) entry = this.#start(key, family, settings)
    else {
      // Most recently used last, so eviction takes the face longest unused.
      this.#entries.delete(key)
      this.#entries.set(key, entry)
    }
    if (entry.state === 'ready') return { font: `"${entry.family}", ${font}` }
    if (entry.state === 'failed') return { error: entry.error }
    return { pending: true }
  }

  /** Resolves when no face is loading, or after `timeoutMs`. */
  settle(timeoutMs: number): Promise<void> {
    if (this.#inflight.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      void Promise.allSettled([...this.#inflight]).then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Called whenever a face finishes loading, or fails to. */
  onReady(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #start(key: string, family: string, settings: string): Entry {
    const synthetic = `__brf_axes_${++this.#next}`
    const entry: Entry = { family: synthetic, state: 'loading' }
    this.#entries.set(key, entry)
    this.#evict()

    const rules = this.#env.rulesFor(family)
    const sources: FaceSource[] =
      rules.length > 0
        ? rules
        : // An installed font: ranges wide enough that a requested weight or stretch reaches the
          // font's own axes rather than being clamped to one value (or faked in bold).
          [{ src: localNames(family).map((n) => `local("${n.replace(/"/g, '')}")`).join(', '), weight: '1 1000', stretch: '50% 200%' }]

    const loading = Promise.allSettled(sources.map((source) => this.#env.load(synthetic, source, settings))).then((results) => {
      this.#inflight.delete(loading)
      if (this.#entries.get(key) !== entry) return // evicted while loading
      if (results.some((r) => r.status === 'fulfilled')) {
        this.#entries.set(key, { family: synthetic, state: 'ready' })
      } else {
        this.#env.remove(synthetic)
        const imported = this.#env.importedFamilies?.() ?? []
        const bundled = this.#env.families().filter((f) => !imported.includes(f))
        const quoted = (list: string[]): string => list.map((f) => `"${f}"`).join(', ')
        this.#entries.set(key, {
          family: synthetic,
          state: 'failed',
          error:
            rules.length > 0
              ? `font "${family}" could not be loaded with variations ${settings}`
              : `font "${family}" cannot take variations: it is not a font this project imported` +
                (imported.length ? ` (${quoted(imported)})` : ' (none — import_media a .ttf/.otf/.woff2 to add one)') +
                `, not one of bay's fonts` +
                (bundled.length ? ` (${quoted(bundled)})` : '') +
                ` and no installed font answers to ${localNames(family).map((n) => `"${n}"`).join(', ')}. ` +
                `Import the font file with import_media and name its family, name an installed font by its full or PostScript name (e.g. "Skia-Regular"), or drop variations`
        })
      }
      for (const listener of this.#listeners) listener()
    })
    this.#inflight.add(loading)
    return entry
  }

  /**
   * Forgets every face of `families` and every face that failed, so the next ask starts again.
   * Called when the project's imported fonts change: a family refused before its file was
   * imported must not stay refused after, and a clone of a removed font must not outlive it.
   */
  forget(families: readonly string[]): void {
    const names = new Set(families.map((f) => f.toLowerCase()))
    for (const [key, entry] of [...this.#entries]) {
      const family = key.slice(0, key.indexOf('|'))
      if (entry.state !== 'failed' && !names.has(family)) continue
      this.#entries.delete(key)
      this.#env.remove(entry.family)
    }
  }

  #evict(): void {
    while (this.#entries.size > MAX_FACES) {
      const oldest = this.#entries.keys().next().value as string
      const entry = this.#entries.get(oldest)!
      this.#entries.delete(oldest)
      this.#env.remove(entry.family)
    }
  }
}

/** Every distinct (font, variations) the documents' text asks for — what `verify` checks. */
export function variationRequests(docs: readonly BrfDocument[]): { font: string; variations: Variations }[] {
  const seen = new Map<string, { font: string; variations: Variations }>()
  const walk = (layers: readonly Layer[]): void => {
    for (const layer of layers) {
      if (layer.type === 'group') walk(layer.layers)
      else if (layer.type === 'text' && layer.variations && Object.keys(layer.variations).length > 0) {
        const font = layer.font ?? DEFAULT_FONT
        const key = `${firstFamily(font).toLowerCase()}|${variationSettings(layer.variations)}`
        if (!seen.has(key)) seen.set(key, { font, variations: layer.variations })
      }
    }
  }
  for (const doc of docs) walk(doc.layers)
  return [...seen.values()]
}

/** Resolves `url(…)` references in a `src` value against the stylesheet they came from. */
export function absoluteSrc(src: string, base: string): string {
  return src.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, _q: string, url: string) => {
    try {
      return `url("${new URL(url, base).href}")`
    } catch {
      return `url("${url}")`
    }
  })
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2')

/** The page's fonts: its `@font-face` rules, `FontFace` and `document.fonts`. */
function documentEnv(): FontEnv {
  const rules = (): { family: string; source: FaceSource }[] => {
    const out: { family: string; source: FaceSource }[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList
      try {
        list = sheet.cssRules
      } catch {
        continue // a sheet the page may not read
      }
      for (const rule of Array.from(list)) {
        if (!(rule instanceof CSSFontFaceRule)) continue
        const style = rule.style
        const get = (name: string): string | undefined => style.getPropertyValue(name).trim() || undefined
        const src = get('src')
        if (!src) continue
        out.push({
          family: unquote(style.getPropertyValue('font-family')),
          source: {
            src: absoluteSrc(src, sheet.href ?? document.baseURI),
            weight: get('font-weight'),
            style: get('font-style'),
            stretch: get('font-stretch'),
            unicodeRange: get('unicode-range')
          }
        })
      }
    }
    return out
  }
  return {
    // An imported font first: it is the face the project asked for, from its own file.
    rulesFor: (family) => {
      const imported = importedFonts.sourcesFor(family)
      if (imported.length > 0) return imported
      return rules().filter((r) => r.family.toLowerCase() === family.toLowerCase()).map((r) => r.source)
    },
    families: () => [...new Set([...importedFonts.families(), ...rules().map((r) => r.family)])],
    importedFamilies: () => importedFonts.families(),
    async load(family, source, settings) {
      const descriptors: Record<string, string> = { variationSettings: settings }
      if (source.weight) descriptors.weight = source.weight
      if (source.style) descriptors.style = source.style
      if (source.stretch) descriptors.stretch = source.stretch
      if (source.unicodeRange) descriptors.unicodeRange = source.unicodeRange
      const face = new FontFace(family, source.src, descriptors as FontFaceDescriptors)
      document.fonts.add(face)
      await face.load()
    },
    remove(family) {
      for (const face of Array.from(document.fonts)) if (face.family === family || unquote(face.family) === family) document.fonts.delete(face)
    }
  }
}

/** Where there is no document (the Node tests), nothing loads and every font is refused. */
const noEnv: FontEnv = {
  rulesFor: () => [],
  families: () => [],
  load: () => Promise.reject(new Error('no document to load fonts into')),
  remove: () => {}
}

/** The one set of faces preview, `preview_frame` and export all draw through. */
export const variationFaces = new VariationFaces(typeof document !== 'undefined' && typeof FontFace !== 'undefined' ? documentEnv() : noEnv)

importedFonts.onChange((families) => variationFaces.forget(families))
