/**
 * The editing-style catalog: the built-in styles, the one validator every style passes through
 * (built-in in the tests, user styles every time they are written *and* read), the search that
 * ranks them, and the markdown a style is served as over `bay://style/<id>`.
 *
 * A user style is text from a file anyone could have handed the user, and its body is read by
 * the model as instructions. So `checkStyle` treats it like a pinned asset name: every angle
 * bracket becomes a look-alike (‹ ›) so nothing in it can pose as markup bay attached — a
 * `<bay-skill>` block, a `<script>` — control characters go, and every field has a size cap. It
 * is never run: bay only ever reads it back as text.
 */

import { CANVAS_PRESETS } from '../project'
import { SUBTITLE_STYLES } from '../subtitles'
import { EASE_NAMES } from '../keyframes'
import { pinText } from '../pins'
import {
  STYLE_APPLIES_TO,
  STYLE_BASES,
  type EditingStyle,
  type StyleEase,
  type StyleOrigin,
  type StyleParams
} from './types'
import { style as retentionTalkingHead } from './retention-talking-head'
import { style as newsLowerThirds } from './news-lower-thirds'
import { style as kineticTypography } from './kinetic-typography'
import { style as luxuryMinimal } from './luxury-minimal'
import { style as ugcAd } from './ugc-ad'
import { style as productLaunchFilm } from './product-launch-film'

export * from './types'

export const BUILT_IN_STYLES: readonly EditingStyle[] = [
  retentionTalkingHead,
  newsLowerThirds,
  kineticTypography,
  luxuryMinimal,
  ugcAd,
  productLaunchFilm
]

export const STYLE_URI_PREFIX = 'bay://style/'

export function styleUri(id: string): string {
  return `${STYLE_URI_PREFIX}${id}`
}

/** Slugs, like skill names: lowercase letters, digits and single hyphens. */
export const STYLE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Every cap a style is held to. Refusals quote them, so the agent knows what fits. */
export const STYLE_LIMITS = {
  id: 48,
  title: 80,
  summary: 400,
  tags: 12,
  tag: 32,
  formats: 8,
  footage: 1000,
  bodyMin: 40,
  body: 12_000,
  params: 16_000,
  paramText: 300,
  sources: 20,
  sourceLabel: 200,
  sourceUrl: 500,
  /** The whole style, as the JSON main writes. */
  file: 48_000,
  /** How many user styles main keeps. */
  userStyles: 200
} as const

/** The fields `write_style` accepts, in the order a refusal lists them. */
export const STYLE_INPUT_FIELDS = ['id', 'title', 'summary', 'tags', 'formats', 'appliesTo', 'footage', 'body', 'params', 'sources', 'basedOn'] as const

const PARAM_FIELDS = ['canvas', 'palette', 'type', 'motion', 'eases', 'captions', 'timing', 'audio', 'grade'] as const

/** One line of someone else's text, safe to quote: no markup, no line breaks. */
export function styleLine(text: string): string {
  return pinText(text).replace(/\s+/g, ' ').trim()
}

/**
 * A block of someone else's text, safe to hand the model: line breaks kept, but no angle
 * brackets (so no tag of any kind survives) and no other control characters.
 */
export function styleBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .trim()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

function isEase(value: unknown): value is StyleEase {
  if (typeof value === 'string') return (EASE_NAMES as readonly string[]).includes(value)
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

const EASE_HELP = `an ease is one of ${EASE_NAMES.join(', ')} or a cubic-bezier [x1, y1, x2, y2]`

/**
 * Checks and cleans a style. `origin: 'user'` also strips markup from every text field and refuses
 * a built-in id; `'built-in'` is how the tests hold the shipped styles to the same schema.
 *
 * Every refusal is a list, each entry saying what to change — the agent fixes them all at once.
 */
export function checkStyle(
  input: unknown,
  options: { origin: StyleOrigin; builtInIds?: readonly string[] }
): { ok: true; style: EditingStyle } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: [`A style is an object with ${STYLE_INPUT_FIELDS.join(', ')}.`] }
  const user = options.origin === 'user'
  const line = (text: string): string => (user ? styleLine(text) : text)
  const block = (text: string): string => (user ? styleBlock(text) : text)

  const allowed: readonly string[] = user ? STYLE_INPUT_FIELDS : [...STYLE_INPUT_FIELDS, 'preview']
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    errors.push(`Unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. The fields are ${STYLE_INPUT_FIELDS.join(', ')}.`)
  }

  const text = (key: string, max: number, required: boolean, clean: (s: string) => string): string | undefined => {
    const value = input[key]
    // An optional field left empty is absent — and must read back as it was written.
    if (!required && (value === undefined || (typeof value === 'string' && clean(value).length === 0))) return undefined
    if (typeof value !== 'string' || clean(value).length === 0) {
      errors.push(`${key} must be ${required ? 'a non-empty' : 'a'} string.`)
      return undefined
    }
    const cleaned = clean(value)
    if (cleaned.length > max) errors.push(`${key} is ${cleaned.length} characters; the limit is ${max}.`)
    return cleaned
  }

  const id = typeof input.id === 'string' ? input.id : ''
  if (!STYLE_ID.test(id) || id.length > STYLE_LIMITS.id) {
    errors.push(
      `id "${styleLine(String(input.id ?? '')).slice(0, 60)}" is not a style id: use lowercase letters, digits and single hyphens, ` +
        `at most ${STYLE_LIMITS.id} characters, such as "warm-podcast-clip".`
    )
  } else if (user && options.builtInIds?.includes(id)) {
    errors.push(
      `id "${id}" is a built-in style, and a user style cannot replace one. Choose another id ` +
        `(for example "${id}-custom") and pass basedOn: "${id}" to record where it came from.`
    )
  }
  const title = text('title', STYLE_LIMITS.title, true, line)
  const summary = text('summary', STYLE_LIMITS.summary, true, line)
  const footage = text('footage', STYLE_LIMITS.footage, !user, block)
  const body = text('body', STYLE_LIMITS.body, true, block)
  if (body !== undefined && body.length < STYLE_LIMITS.bodyMin) {
    errors.push(`body is ${body.length} characters; write the steps out (at least ${STYLE_LIMITS.bodyMin}).`)
  }

  const list = (key: string, max: number, required: boolean): string[] => {
    const value = input[key]
    if (value === undefined && !required) return []
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      errors.push(`${key} must be a list of strings.`)
      return []
    }
    if (value.length > max) errors.push(`${key} has ${value.length} entries; the limit is ${max}.`)
    return value as string[]
  }

  const tags = list('tags', STYLE_LIMITS.tags, true).map((tag) => tag.trim().toLowerCase())
  const badTags = tags.filter((tag) => !STYLE_ID.test(tag) || tag.length > STYLE_LIMITS.tag)
  if (badTags.length > 0) {
    errors.push(`tags ${badTags.map((t) => `"${styleLine(t).slice(0, 40)}"`).join(', ')} must be lowercase words joined by hyphens, at most ${STYLE_LIMITS.tag} characters each.`)
  }
  if (tags.length === 0 && Array.isArray(input.tags)) errors.push('tags needs at least one entry, such as "talking-head" or "vertical".')

  const canvasIds = CANVAS_PRESETS.map((preset) => preset.id)
  const formats = list('formats', STYLE_LIMITS.formats, !user)
  const badFormats = formats.filter((format) => !canvasIds.includes(format))
  if (badFormats.length > 0) errors.push(`formats ${badFormats.map((f) => styleLine(f)).join(', ')} are not canvases; use ${canvasIds.join(', ')}.`)

  const appliesTo = list('appliesTo', STYLE_APPLIES_TO.length, !user)
  const badApplies = appliesTo.filter((a) => !(STYLE_APPLIES_TO as readonly string[]).includes(a))
  if (badApplies.length > 0) errors.push(`appliesTo ${badApplies.map((a) => styleLine(a)).join(', ')} are unknown; use ${STYLE_APPLIES_TO.join(', ')}.`)

  let basedOn: string | undefined
  if (input.basedOn !== undefined) {
    if (typeof input.basedOn !== 'string' || !STYLE_ID.test(input.basedOn)) errors.push('basedOn must be the id of the style this one came from.')
    else basedOn = input.basedOn
  }

  const sources: EditingStyle['sources'] = []
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) errors.push('sources must be a list of { id, label, url }.')
    else {
      if (input.sources.length > STYLE_LIMITS.sources) errors.push(`sources has ${input.sources.length} entries; the limit is ${STYLE_LIMITS.sources}.`)
      input.sources.forEach((source, i) => {
        if (!isRecord(source) || typeof source.id !== 'string' || typeof source.label !== 'string' || typeof source.url !== 'string') {
          errors.push(`sources[${i}] must be { id, label, url }.`)
          return
        }
        const url = source.url.trim()
        const web = /^https:\/\/[^\s<>"]+$/.test(url)
        const repo = !user && /^(r&d|src)\/[^\s<>"]+$/.test(url)
        if (!STYLE_ID.test(source.id)) errors.push(`sources[${i}].id must be a slug; cite it in the body as [id].`)
        if (!web && !repo) errors.push(`sources[${i}].url must be an https:// address.`)
        if (url.length > STYLE_LIMITS.sourceUrl || source.label.length > STYLE_LIMITS.sourceLabel) errors.push(`sources[${i}] is too long.`)
        sources.push({ id: source.id, label: line(source.label), url })
      })
    }
  }

  const params = checkParams(input.params, { user, errors, sourceIds: sources.map((s) => s.id) })

  let preview: string | undefined
  if (!user && input.preview !== undefined) {
    if (typeof input.preview !== 'string') errors.push('preview must be a string.')
    else preview = input.preview
  }

  if (errors.length > 0) return { ok: false, errors }
  const style: EditingStyle = {
    id,
    title: title!,
    summary: summary!,
    tags,
    formats,
    appliesTo: appliesTo as EditingStyle['appliesTo'],
    footage: footage ?? '',
    body: body!,
    params,
    sources,
    ...(basedOn ? { basedOn } : {}),
    ...(preview ? { preview } : {})
  }
  const size = JSON.stringify(style).length
  if (size > STYLE_LIMITS.file) return { ok: false, errors: [`The style is ${size} characters as JSON; the limit is ${STYLE_LIMITS.file}. Shorten the body or params.`] }
  return { ok: true, style }
}

function checkParams(
  input: unknown,
  context: { user: boolean; errors: string[]; sourceIds: string[] }
): StyleParams {
  const { errors } = context
  if (input === undefined) return {}
  if (!isRecord(input)) {
    errors.push(`params must be an object with any of ${PARAM_FIELDS.join(', ')}.`)
    return {}
  }
  const size = JSON.stringify(input).length
  if (size > STYLE_LIMITS.params) errors.push(`params is ${size} characters as JSON; the limit is ${STYLE_LIMITS.params}.`)
  const unknown = Object.keys(input).filter((key) => !(PARAM_FIELDS as readonly string[]).includes(key))
  if (unknown.length > 0) errors.push(`params has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}; use ${PARAM_FIELDS.join(', ')}.`)

  // Every string inside params: capped, and cleaned for a user style.
  const clean = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const cleaned = context.user ? styleLine(value) : value
      if (cleaned.length > STYLE_LIMITS.paramText) errors.push(`${path} is ${cleaned.length} characters; the limit is ${STYLE_LIMITS.paramText}.`)
      return cleaned
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(`${path} must be a finite number.`)
      return value
    }
    if (typeof value === 'boolean' || value === null) return value
    if (Array.isArray(value)) return value.map((v, i) => clean(v, `${path}[${i}]`))
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [context.user ? styleLine(k) : k, clean(v, `${path}.${k}`)]))
    errors.push(`${path} must be text, a number, a list or an object.`)
    return undefined
  }
  const params = clean(input, 'params') as Record<string, unknown>
  const at = (key: string): unknown => params[key]

  const canvas = at('canvas')
  if (canvas !== undefined && !CANVAS_PRESETS.some((preset) => preset.id === canvas)) {
    errors.push(`params.canvas must be a set_canvas preset: ${CANVAS_PRESETS.map((p) => p.id).join(', ')}.`)
  }
  const palette = at('palette')
  if (palette !== undefined) {
    if (!Array.isArray(palette)) errors.push('params.palette must be a list of { name, hex, role? }.')
    else
      palette.forEach((colour, i) => {
        if (!isRecord(colour) || typeof colour.name !== 'string' || typeof colour.hex !== 'string' || !HEX.test(colour.hex)) {
          errors.push(`params.palette[${i}] must be { name, hex: "#RRGGBB" or "#RRGGBBAA", role? }.`)
        }
      })
  }
  const type = at('type')
  if (type !== undefined) {
    if (!Array.isArray(type)) errors.push('params.type must be a list of { role, family?, weight?, sizePx?, trackingEm?, case? }.')
    else
      type.forEach((entry, i) => {
        if (!isRecord(entry) || typeof entry.role !== 'string') errors.push(`params.type[${i}] needs a role.`)
        else if (entry.case !== undefined && !['upper', 'sentence', 'title', 'lower'].includes(String(entry.case))) {
          errors.push(`params.type[${i}].case must be upper, sentence, title or lower.`)
        }
      })
  }
  const motion = at('motion')
  if (motion !== undefined) {
    if (!Array.isArray(motion)) errors.push('params.motion must be a list of { name, frames?, seconds?, ease?, spring? }.')
    else
      motion.forEach((entry, i) => {
        if (!isRecord(entry) || typeof entry.name !== 'string') errors.push(`params.motion[${i}] needs a name.`)
        else if (entry.ease !== undefined && !isEase(entry.ease)) errors.push(`params.motion[${i}].ease: ${EASE_HELP}.`)
      })
  }
  const eases = at('eases')
  if (eases !== undefined) {
    if (!isRecord(eases)) errors.push('params.eases must be an object of { name: ease }.')
    else
      for (const [name, ease] of Object.entries(eases)) {
        if (!isEase(ease)) errors.push(`params.eases.${name}: ${EASE_HELP}.`)
      }
  }
  const captions = at('captions')
  if (captions !== undefined) {
    const designs = SUBTITLE_STYLES.map((s) => s.id)
    if (!isRecord(captions) || !designs.includes(captions.design as never)) {
      errors.push(`params.captions.design must be an add_subtitles style: ${designs.join(', ')}.`)
    } else {
      if (captions.accent !== undefined && !HEX.test(String(captions.accent))) errors.push('params.captions.accent must be a hex colour.')
      if (captions.scale !== undefined && !(typeof captions.scale === 'number' && captions.scale >= 0.5 && captions.scale <= 2)) {
        errors.push('params.captions.scale must be 0.5 to 2, as add_subtitles takes it.')
      }
      if (captions.bottom !== undefined && !(typeof captions.bottom === 'number' && captions.bottom >= 0 && captions.bottom <= 90)) {
        errors.push('params.captions.bottom must be 0 to 90 (percent from the bottom), as add_subtitles takes it.')
      }
    }
  }
  const timing = at('timing')
  if (timing !== undefined) {
    if (!isRecord(timing)) errors.push('params.timing must be an object of { name: { value: [low, high], unit, basis, source?, note? } }.')
    else
      for (const [name, measure] of Object.entries(timing)) {
        if (
          !isRecord(measure) ||
          !Array.isArray(measure.value) ||
          measure.value.length !== 2 ||
          !measure.value.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
          typeof measure.unit !== 'string'
        ) {
          errors.push(`params.timing.${name} must be { value: [low, high], unit, basis }.`)
          continue
        }
        if (!(STYLE_BASES as readonly string[]).includes(String(measure.basis))) {
          errors.push(`params.timing.${name}.basis must be one of ${STYLE_BASES.join(', ')}.`)
        } else if ((measure.basis === 'measured' || measure.basis === 'platform') && !context.sourceIds.includes(String(measure.source))) {
          errors.push(
            `params.timing.${name} is ${measure.basis}, so it needs a source: set source to one of the style's sources ids` +
              (context.sourceIds.length ? ` (${context.sourceIds.join(', ')})` : ' (add one to sources)') +
              `, or call it observed (you measured it from the reference with bay's tools), rule-of-thumb or estimate.`
          )
        }
      }
  }
  const audio = at('audio')
  if (audio !== undefined) {
    if (!isRecord(audio)) errors.push('params.audio must be { musicDb?, loudness?, note? }.')
    else {
      if (audio.loudness !== undefined && !['streaming', 'podcast', 'broadcast', 'off'].includes(String(audio.loudness))) {
        errors.push('params.audio.loudness must be streaming, podcast, broadcast or off (export_timeline presets).')
      }
      if (audio.musicDb !== undefined && !(typeof audio.musicDb === 'number' && audio.musicDb <= 0)) errors.push('params.audio.musicDb must be 0 or below (dB under the voice).')
    }
  }
  if (at('grade') !== undefined && !isRecord(at('grade'))) errors.push('params.grade must be an object in edit_item grade terms.')
  return params as StyleParams
}

export interface StyleEntry {
  style: EditingStyle
  origin: StyleOrigin
}

export interface StyleHit {
  id: string
  title: string
  summary: string
  tags: string[]
  appliesTo: string[]
  source: StyleOrigin
  score: number
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'style', 'video', 'edit', 'like', 'my', 'me', 'make', 'it'])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
}

/** Whole-word or prefix match: "caption" finds "captions", "talk" finds "talking". */
const hits = (word: string, pool: readonly string[]): boolean => pool.some((w) => w === word || (word.length >= 4 && w.startsWith(word)))

/**
 * Ranks styles for a query, lexically: a tag is worth most, then the title, then the summary and
 * what footage suits it. `tags` and `appliesTo` filter (a style must carry every one given). No
 * query lists every match, built-ins first. Ties break by id, so the order is stable.
 */
export function searchStyles(
  entries: readonly StyleEntry[],
  request: { query?: string; tags?: readonly string[]; appliesTo?: readonly string[] }
): StyleHit[] {
  const query = words(request.query ?? '')
  const wantTags = (request.tags ?? []).map((t) => t.toLowerCase())
  const wantApplies = request.appliesTo ?? []
  const scored: StyleHit[] = []
  for (const { style, origin } of entries) {
    if (!wantTags.every((tag) => style.tags.includes(tag))) continue
    if (!wantApplies.every((a) => (style.appliesTo as string[]).includes(a))) continue
    const tagWords = style.tags.flatMap((tag) => [tag, ...tag.split('-')])
    const titleWords = words(style.title)
    const idWords = style.id.split('-')
    const summaryWords = words(style.summary)
    const footageWords = words(style.footage)
    let score = 0
    for (const word of query) {
      let best = 0
      if (hits(word, tagWords)) best = Math.max(best, 4)
      if (hits(word, titleWords) || hits(word, idWords)) best = Math.max(best, 3)
      if (hits(word, summaryWords)) best = Math.max(best, 2)
      if (hits(word, footageWords)) best = Math.max(best, 1)
      score += best
    }
    if (query.length > 0 && score === 0) continue
    scored.push({ id: style.id, title: style.title, summary: style.summary, tags: style.tags, appliesTo: style.appliesTo, source: origin, score })
  }
  return scored.sort(
    (a, b) => b.score - a.score || (a.source === b.source ? 0 : a.source === 'built-in' ? -1 : 1) || a.id.localeCompare(b.id)
  )
}

/** A style as a markdown document — the `bay://style/<id>` body. */
export function styleMarkdown(style: EditingStyle, origin: StyleOrigin = 'built-in'): string {
  const lines = [
    `# ${style.title}`,
    '',
    style.summary,
    '',
    `- id: \`${style.id}\` (${origin})${style.basedOn ? `, based on \`${style.basedOn}\`` : ''}`,
    `- tags: ${style.tags.join(', ')}`,
    `- canvases: ${style.formats.join(', ') || 'any'}`,
    `- has opinions on: ${style.appliesTo.join(', ')}`,
    '',
    '## Footage it suits',
    '',
    style.footage,
    '',
    '## Steps',
    '',
    style.body,
    '',
    '## Design tokens',
    '',
    '```json',
    JSON.stringify(style.params, null, 2),
    '```'
  ]
  if (style.sources.length > 0) {
    lines.push('', '## Sources', '', ...style.sources.map((s) => `- [${s.id}] ${s.label}: ${s.url}`))
  }
  return lines.join('\n') + '\n'
}

/** The built-in style with this id. */
export function findBuiltInStyle(id: string): EditingStyle | undefined {
  return BUILT_IN_STYLES.find((style) => style.id === id)
}

export const BUILT_IN_STYLE_IDS: readonly string[] = BUILT_IN_STYLES.map((style) => style.id)

/**
 * User styles as main hands them back: each one checked again (the file may have been edited, or
 * written by another build), any that fail named rather than silently dropped, and none allowed
 * to take a built-in id.
 */
export function readUserStyles(raw: readonly unknown[]): { styles: EditingStyle[]; skipped: string[] } {
  const styles: EditingStyle[] = []
  const skipped: string[] = []
  for (const entry of raw) {
    const checked = checkStyle(entry, { origin: 'user', builtInIds: BUILT_IN_STYLE_IDS })
    if (checked.ok) {
      if (!styles.some((s) => s.id === checked.style.id)) styles.push(checked.style)
    } else {
      const id = isRecord(entry) && typeof entry.id === 'string' ? styleLine(entry.id).slice(0, 60) : '(no id)'
      skipped.push(`${id}: ${checked.errors[0]}`)
    }
  }
  return { styles, skipped }
}
