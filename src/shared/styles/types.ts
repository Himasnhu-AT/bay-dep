/**
 * An editing style: a recognisable look and rhythm, written as data the agent can search, read
 * and apply with bay's own tools.
 *
 * Skills (`../skills.ts`) are *processes* — how to caption, how to tighten a talking head. A style
 * is a *look*: a retention short, a news package, a luxury film. It carries steps the agent
 * follows (`body`, which names only real tools and parameters — `styles.test.ts` holds it to the
 * catalog) and the design tokens those steps use (`params`), plus the sources behind any number
 * presented as more than a rule of thumb.
 *
 * Built-in styles live one per file beside this one. User styles are the same shape, saved as
 * JSON by `write_style` into `<userData>/styles` and read back through `checkStyle` — they are
 * text someone else may have written, so they are validated and stripped of markup every time
 * they are read, and nothing in one is ever run.
 */

import type { SubtitleStyleId } from '../subtitles'

/** What part of an edit a style has an opinion about. `search_styles` filters on these. */
export const STYLE_APPLIES_TO = ['pacing', 'structure', 'captions', 'graphics', 'grade', 'audio', 'transitions', 'framing'] as const
export type StyleAppliesTo = (typeof STYLE_APPLIES_TO)[number]

/**
 * How much weight a number carries. Only `measured` and `platform` may be stated as fact, and
 * each needs a source; the rest are labelled in the body as what they are. `observed` and
 * `inferred` are for a style made from a reference video: computed from bay's tool output on
 * that video, or judged from its frames.
 */
export const STYLE_BASES = ['measured', 'platform', 'observed', 'inferred', 'rule-of-thumb', 'house', 'estimate'] as const
export type StyleBasis = (typeof STYLE_BASES)[number]

/** A keyframe or `.brf` ease: bay's named eases, or a cubic-bezier `[x1, y1, x2, y2]`. */
export type StyleEase = 'linear' | 'hold' | 'in' | 'out' | 'inOut' | [number, number, number, number]

export interface StyleColour {
  name: string
  /** `#RRGGBB` or `#RRGGBBAA`. */
  hex: string
  /** What it is for: "text", "keyword accent", "bar". */
  role?: string
}

export interface StyleType {
  /** "caption", "headline", "lower-third name". */
  role: string
  /** A family to look for in the media pool first; never claimed as the reference's exact font. */
  family?: string
  weight?: number
  /** At 1080 on the short side. */
  sizePx?: number
  /** In em: -0.04 is tight, 0.15 is wide. */
  trackingEm?: number
  case?: 'upper' | 'sentence' | 'title' | 'lower'
  note?: string
}

export interface StyleMotion {
  /** "punch-in", "headline entrance". */
  name: string
  /** At 30 fps unless `seconds` is given instead. */
  frames?: number
  seconds?: number
  ease?: StyleEase
  /** For `.brf` springs: `spring(t, { stiffness, damping })`. */
  spring?: { stiffness: number; damping: number }
  note?: string
}

export interface StyleCaptions {
  /** An `add_subtitles` design. */
  design: SubtitleStyleId
  accent?: string
  /** `add_subtitles` scale, 0.5–2. */
  scale?: number
  /** `add_subtitles` bottom, percent 0–90. */
  bottom?: number
  /** Words on screen at once. */
  words?: [number, number]
  note?: string
}

/** A number with its weight: a range, what it measures, and where it comes from. */
export interface StyleMeasure {
  value: [number, number]
  unit: string
  basis: StyleBasis
  /** A `sources[].id` — required when `basis` is `measured` or `platform`. */
  source?: string
  note?: string
}

export interface StyleAudio {
  /** Music bed level against the voice, dB (negative). */
  musicDb?: number
  /** An `export_timeline` loudness preset. */
  loudness?: 'streaming' | 'podcast' | 'broadcast' | 'off'
  note?: string
}

export interface StyleParams {
  /** A canvas preset id (`set_canvas`), when the style has one. */
  canvas?: string
  palette?: StyleColour[]
  type?: StyleType[]
  motion?: StyleMotion[]
  /** Named eases the body refers to: `{ rise: [0.165, 0.84, 0.44, 1] }`. */
  eases?: Record<string, StyleEase>
  captions?: StyleCaptions
  /** Pacing and timing numbers by name: `{ cutsPerMinute: …, lowerThirdHoldSeconds: … }`. */
  timing?: Record<string, StyleMeasure>
  audio?: StyleAudio
  /** Grade intent in `edit_item.grade` terms, as a partial object the body applies. */
  grade?: Record<string, unknown>
}

export interface StyleSource {
  /** Cited in the body as `[id]`. Lowercase letters, digits and hyphens. */
  id: string
  label: string
  /** https:// for the web; a repo path for bay's own studies. */
  url: string
}

export interface EditingStyle {
  /** Slug: lowercase letters, digits and hyphens. */
  id: string
  title: string
  /** One or two sentences: what it looks like and when to use it. */
  summary: string
  tags: string[]
  /** Canvas preset ids it is made for, first the usual one. */
  formats: string[]
  appliesTo: StyleAppliesTo[]
  /** What raw footage suits it — and what it cannot rescue. */
  footage: string
  /** Numbered imperative steps, naming only real bay tools and parameters. */
  body: string
  params: StyleParams
  sources: StyleSource[]
  /** The style this one was derived from (user styles). */
  basedOn?: string
  /** Reserved for the agent panel's preview tile: a `bay://` path to a still. Not set yet. */
  preview?: string
}

export type StyleOrigin = 'built-in' | 'user'
