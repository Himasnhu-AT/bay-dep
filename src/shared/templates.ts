/**
 * The composition templates bay ships.
 *
 * A template is an ordinary HyperFrames composition with its variables declared, so the same
 * file is configurable from the inspector *and* from `edit_item({ variables })` without either
 * side knowing what the other can set. Nothing here is a special format: an agent fetches the
 * HTML, changes it or doesn't, and `write_composition`s it into the project. That is the point
 * — a template is a starting document, not a runtime the engine has to understand.
 *
 * **Why a catalog instead of reading the directory.** The bodies are inlined into the bundle by
 * `?raw`, so a template that is listed but missing is a build error rather than a read that
 * fails on a user's machine — the same reasoning as `RESOURCES`, and the pairing is checked in
 * the same way.
 *
 * **A template is sized to the canvas it lands on, not the one it was drawn for.** Every
 * template used to be authored at a fixed 1080x1920 and placed as-is. Placement *fits* an asset
 * rather than stretching it — measured: a 1080x1920 template on a 1920x1080 project landed in a
 * 608x1080 box at x=656 — so nothing was distorted, and that was the problem: a lower third for
 * a vertical frame became a narrow strip down the middle of a landscape one, correct in every
 * proportion and useless for its purpose.
 *
 * So the templates are size-aware rather than duplicated per orientation. The composition
 * contract requires a root sized in pixels, and that stays true: `sizeTemplate` rewrites the
 * root's two numbers to the timeline's width and height before the file is written, and the
 * layout inside never uses a fixed pixel — lengths are multiples of `--u` (one pixel of a frame
 * whose short side is 1080, via container units) and positions are percentages of the frame.
 * `width`/`height` in the catalog are therefore the size the file *ships* at, which is what an
 * agent fetching the raw resource receives, not a size the template is limited to.
 *
 * `add_template` (and the Templates panel, which calls the same function) does the sizing,
 * writing and placing in one step. An agent building from the raw resource instead changes the
 * root's `width`/`height` itself — never the item's layout, which would stretch the picture.
 */

import type { CompositionVariable } from './composition'

export interface TemplateSpec {
  /** Also the `data-composition-id` inside the file, and the last segment of its uri. */
  id: string
  name: string
  description: string
  /** What it is for, so a listing can group without parsing descriptions. */
  category: 'caption' | 'identity' | 'emphasis' | 'structure'
  durationSeconds: number
  /** The size the file ships at. `sizeTemplate` replaces it with the canvas's. */
  width: number
  height: number
  /**
   * The declarations exactly as the file makes them, defaults included — so the Templates panel
   * can draw its fields without reading the file. Held equal to the file by `templates.test.ts`,
   * which compares the whole declaration rather than the ids: a default that drifted here would
   * be a field showing one value while the clip renders another.
   */
  variables: readonly CompositionVariable[]
}

export const TEMPLATE_URI_PREFIX = 'bay://template/'

export const TEMPLATES: readonly TemplateSpec[] = [
  {
    id: 'subtitle',
    name: 'Subtitle',
    description:
      'One line of speech at the bottom of the frame, rising in and out. The workhorse: a ' +
      'short-form video is mostly this. For word-level highlighting, generate one composition ' +
      'per line from a transcript rather than placing many of these.',
    category: 'caption',
    durationSeconds: 3,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'text', type: 'string', label: 'Subtitle', default: 'Everything you do lands in the same document.' },
      { id: 'size', type: 'number', label: 'Text size', default: 64, min: 24, max: 120 },
      { id: 'bottom', type: 'number', label: 'Distance from bottom', default: 11, min: 0, max: 90, unit: '%' },
      { id: 'ink', type: 'color', label: 'Text', default: '#FFFFFF' },
      { id: 'pill', type: 'boolean', label: 'Dark pill behind', default: true }
    ]
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    description:
      'Name and role with an accent bar that wipes up. Sits above the caption band so both ' +
      'can be on screen at once.',
    category: 'identity',
    durationSeconds: 4,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'name', type: 'string', label: 'Name', default: 'Your Name' },
      { id: 'role', type: 'string', label: 'Title or role', default: 'Title or role' },
      { id: 'accent', type: 'color', label: 'Accent', default: '#11D1A0' },
      { id: 'bottom', type: 'number', label: 'Distance from bottom', default: 24, min: 0, max: 90, unit: '%' }
    ]
  },
  {
    id: 'title-card',
    name: 'Title card',
    description:
      'Full-frame opener: kicker, title, rule. Dims the footage behind it with a scrim whose ' +
      'strength is a variable, so it can sit over a shot rather than replacing it.',
    category: 'structure',
    durationSeconds: 3.5,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'kicker', type: 'string', label: 'Kicker', default: 'A SHORT FILM ABOUT' },
      { id: 'title', type: 'string', label: 'Title', default: 'Your Title' },
      { id: 'accent', type: 'color', label: 'Kicker colour', default: '#FF4D3D' },
      { id: 'scrim', type: 'number', label: 'Scrim strength', default: 0.72, min: 0, max: 1, step: 0.05 }
    ]
  },
  {
    id: 'callout',
    name: 'Callout chip',
    description:
      'A small labelled chip that pops in at a position you choose. For naming a thing on ' +
      'screen without covering it.',
    category: 'emphasis',
    durationSeconds: 2.5,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'text', type: 'string', label: 'Label', default: 'one edit is one undo step' },
      { id: 'accent', type: 'color', label: 'Border', default: '#7DD3FC' },
      { id: 'x', type: 'number', label: 'X from left', default: 6, min: 0, max: 90, unit: '%' },
      { id: 'y', type: 'number', label: 'Y from top', default: 14, min: 0, max: 90, unit: '%' }
    ]
  },
  {
    id: 'stat',
    name: 'Counting number',
    description:
      'A number that counts up to a target, with a caption. The count is a function of time ' +
      'rather than an accumulator, so scrubbing backwards counts back down.',
    category: 'emphasis',
    durationSeconds: 3,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'to', type: 'number', label: 'Count to', default: 1438 },
      { id: 'caption', type: 'string', label: 'Caption', default: 'frames, all of them' },
      { id: 'ink', type: 'color', label: 'Number', default: '#FFFFFF' },
      { id: 'y', type: 'number', label: 'Y from top', default: 16, min: 0, max: 85, unit: '%' }
    ]
  },
  {
    id: 'progress',
    name: 'Progress bar',
    description:
      'A thin bar that fills linearly across the clip. Linear on purpose — an eased progress ' +
      'bar lies about where you are. Trim the item to the span it should report on.',
    category: 'structure',
    durationSeconds: 10,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'accent', type: 'color', label: 'Fill', default: '#11D1A0' },
      { id: 'thickness', type: 'number', label: 'Thickness', default: 10, min: 2, max: 40 },
      { id: 'top', type: 'number', label: 'Y from top', default: 0, min: 0, max: 99, unit: '%' }
    ]
  },
  {
    id: 'end-card',
    name: 'End card',
    description: 'Closing call to action and handle over a dimmed frame.',
    category: 'structure',
    durationSeconds: 4,
    width: 1080,
    height: 1920,
    variables: [
      { id: 'line', type: 'string', label: 'Call to action', default: 'follow for more' },
      { id: 'handle', type: 'string', label: 'Handle', default: '@yourhandle' },
      { id: 'accent', type: 'color', label: 'Accent', default: '#11D1A0' }
    ]
  }
]

export function templateUri(id: string): string {
  return `${TEMPLATE_URI_PREFIX}${id}`
}

export function findTemplate(id: string): TemplateSpec | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/** The template a `bay://template/...` uri names, or undefined for any other uri. */
export function templateForUri(uri: string): TemplateSpec | undefined {
  if (!uri.startsWith(TEMPLATE_URI_PREFIX)) return undefined
  return findTemplate(uri.slice(TEMPLATE_URI_PREFIX.length))
}

/** The largest canvas side a template will be sized to — an 8K frame. */
export const MAX_TEMPLATE_SIDE = 8192

/** The same root the renderer finds: the first element carrying `data-composition-id`. */
const ROOT_TAG = /<[a-zA-Z][^>]*\bdata-composition-id\s*=\s*["'][^"']*["'][^>]*>/

/**
 * A template's document, sized to a canvas.
 *
 * Rewrites the two pixel numbers in the root's inline style and touches nothing else — the
 * layout inside is written in frame-relative units, so those two numbers are the whole of what
 * orientation means to a template. Throws rather than returning the document unchanged when it
 * cannot do that, because an unchanged document is exactly the bug this exists to fix: a
 * portrait composition that places without complaint as a strip down a landscape frame.
 */
export function sizeTemplate(html: string, width: number, height: number): string {
  for (const [name, value] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_TEMPLATE_SIDE) {
      throw new RangeError(
        `A template's ${name} must be a whole number of pixels from 1 to ${MAX_TEMPLATE_SIDE}; ` +
          `got ${value}.`
      )
    }
  }
  const root = ROOT_TAG.exec(html)
  if (!root) throw new Error('This document has no data-composition-id root to size.')

  const tag = root[0]
  const style = /\bstyle\s*=\s*(["'])([^"']*)\1/.exec(tag)
  if (!style) throw new Error('The composition root has no inline style carrying its size.')

  let next = style[2] ?? ''
  for (const [prop, value] of [['width', width], ['height', height]] as const) {
    // Anchored on a declaration boundary so `line-height` or `max-width` is never taken for it.
    const declaration = new RegExp(`(^|;)(\\s*)${prop}\\s*:\\s*[0-9.]+px`, 'i')
    if (!declaration.test(next)) {
      throw new Error(`The composition root's style declares no ${prop} in pixels to replace.`)
    }
    next = next.replace(declaration, `$1$2${prop}:${value}px`)
  }

  const quote = style[1] ?? '"'
  const sizedTag = tag.replace(style[0], `style=${quote}${next}${quote}`)
  return html.slice(0, root.index) + sizedTag + html.slice(root.index + tag.length)
}

/**
 * The file a sized template is written to: `<id>-<width>x<height>-<hash>.html`.
 *
 * Named by content rather than by id alone, because clips hold on to the file they were placed
 * from. A path reused across template versions would rewrite the document under every clip
 * already placed from it — whose stored variable values were chosen against the old one. With
 * the hash in the name, the same template at the same size is one file however many times it
 * is placed (values live on the clip), and a changed template is a new file beside the old.
 */
export function templateFileName(id: string, width: number, height: number, html: string): string {
  // FNV-1a, 32-bit. Not a security property — only "different bytes, different name".
  let hash = 0x811c9dc5
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${id}-${width}x${height}-${hash.toString(16).padStart(8, '0')}.html`
}
