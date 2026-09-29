/**
 * `<glass>` in `.brf`: the material vocabulary, and the numbers behind it.
 *
 * The material names, the preset numbers and the parameter names come from quick-liquid
 * (https://github.com/amarnath3003/quickLiquid, v0.1.2, MIT — its notice is in NOTICE). Its engine is a DOM
 * one: `backdrop-filter` plus an SVG displacement map on a live element, which cannot run on
 * bay's canvas, in a worker, or in an export. So the package is not a dependency — its
 * `quick-liquid/core` entry bundles that DOM engine alongside the presets, and `src/shared/` may
 * reach no DOM — and only the data is carried over, copied here with its attribution. bay draws
 * the look itself (`engine/glass.ts`: the backdrop, blurred, saturated and bent at the rim; the
 * `.brf` painter: tint, sheen and rim light).
 *
 * `SAFE` is bay's own: where each parameter stops reading as glass. It is what `parseBrf` refuses
 * past and what the guide tells an agent, in the same words, so the two cannot drift.
 */

export const GLASS_MATERIALS = ['clear', 'thin', 'regular', 'thick', 'ultra'] as const
export type GlassMaterial = (typeof GLASS_MATERIALS)[number]

/** A material fully resolved: what the painter and the backdrop pass read. */
export interface GlassLook {
  /** Backdrop blur, px in the layer's own units. */
  blur: number
  /** Backdrop saturation, 1 = unchanged. */
  saturation: number
  /** The tint's colour, as the layer gave it (a colour, or quick-liquid's `"r, g, b"`). */
  tint: string
  tintOpacity: number
  /** How far the backdrop is pulled inward at the very edge, px — quick-liquid's `refractionStrength`. */
  refraction: number
  /** Width of the rim band that bends, px — quick-liquid's `bezelWidth`. */
  bezel: number
  /** Rim light strength, 0–1. */
  edgeHighlight: number
}

/**
 * quick-liquid's `MATERIAL_PRESETS` (src/core/config.ts), the five fixed materials, unchanged.
 * Its `adaptive` material is left out: it samples the backdrop's luminance on a live page.
 * `thickness` is left out too: bay's rim bend is a magnification profile, not its SVG lens.
 */
export const GLASS_PRESETS: Record<GlassMaterial, { blur: number; saturation: number; tintOpacity: number; refraction: number; bezel: number }> = {
  clear: { blur: 2, saturation: 1.55, tintOpacity: 0.03, refraction: 26, bezel: 36 },
  thin: { blur: 6, saturation: 1.5, tintOpacity: 0.05, refraction: 18, bezel: 26 },
  regular: { blur: 14, saturation: 1.7, tintOpacity: 0.09, refraction: 16, bezel: 30 },
  thick: { blur: 22, saturation: 1.8, tintOpacity: 0.13, refraction: 12, bezel: 28 },
  ultra: { blur: 30, saturation: 1.85, tintOpacity: 0.17, refraction: 10, bezel: 26 }
}

/** quick-liquid's `DEFAULT_CONFIG` values for what a preset does not set. */
export const GLASS_DEFAULTS = { material: 'regular' as GlassMaterial, tint: 'rgba(255,255,255,1)', edgeHighlight: 0.9 }

/**
 * The range each number may take, and what goes wrong outside it — written once, read by the
 * validator's refusal and by the guide. Inside quick-liquid's own clamps (blur 0–80, saturation
 * 0–4, refraction 0–150), narrowed to where the picture still reads as glass.
 */
export const GLASS_SAFE: Record<'blur' | 'saturation' | 'tintOpacity' | 'refraction' | 'bezel' | 'edgeHighlight', { min: number; max: number; past: string }> = {
  blur: { min: 0, max: 40, past: 'past 40 px the backdrop turns to fog and the glass reads as a grey card' },
  saturation: { min: 0, max: 2.5, past: 'past 2.5 skin and skies go neon under the glass' },
  tintOpacity: { min: 0, max: 0.6, past: 'past 0.6 the tint hides the backdrop and it reads as a flat card' },
  refraction: { min: 0, max: 60, past: 'past 60 px the rim smears the backdrop into streaks' },
  bezel: { min: 0, max: 120, past: 'past 120 px the bend covers the whole pane and it reads as a fisheye' },
  edgeHighlight: { min: 0, max: 1, past: 'above 1 the rim clips to a white outline' }
}

export function isGlassMaterial(value: unknown): value is GlassMaterial {
  return typeof value === 'string' && (GLASS_MATERIALS as readonly string[]).includes(value)
}

/**
 * A tint as quick-liquid writes it — `"255, 255, 255"`, three channels and no function around
 * them — as `[r, g, b]`, or null when it is not that form. Any colour `.brf` takes is accepted
 * beside it (`parseColor`); this is only the extra spelling.
 */
export function parseTintTriple(text: string): [number, number, number] | null {
  const m = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/.exec(text)
  if (!m) return null
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]
  return rgb.every((n) => n <= 255) ? rgb : null
}

/**
 * A material and the overrides given for it, as one look: overrides win over the preset, the
 * preset over quick-liquid's defaults, and anything not a finite number falls back — a NaN here
 * would reach a canvas `filter` string, where one bad value drops the whole chain.
 */
export function resolveGlass(
  material: GlassMaterial | undefined,
  overrides: Partial<Omit<GlassLook, 'tint'>> & { tint?: string }
): GlassLook {
  const preset = GLASS_PRESETS[material ?? GLASS_DEFAULTS.material]
  const pick = (key: keyof typeof GLASS_SAFE, fallback: number): number => {
    const value = overrides[key]
    const safe = GLASS_SAFE[key]
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return Math.max(safe.min, Math.min(safe.max, n))
  }
  return {
    blur: pick('blur', preset.blur),
    saturation: pick('saturation', preset.saturation),
    tint: overrides.tint ?? GLASS_DEFAULTS.tint,
    tintOpacity: pick('tintOpacity', preset.tintOpacity),
    refraction: pick('refraction', preset.refraction),
    bezel: pick('bezel', preset.bezel),
    edgeHighlight: pick('edgeHighlight', GLASS_DEFAULTS.edgeHighlight)
  }
}
