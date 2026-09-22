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
 * **Every template is authored at 1080x1920, and that matters on a landscape timeline.** A
 * composition's size is static in its root element, and placement *fits* the asset rather than
 * stretching it — measured: a 1080x1920 template on a 1920x1080 project lands in a 608x1080 box
 * at x=656, which is the source aspect to within a rounded pixel. So nothing is distorted, and
 * that is the problem: a lower third authored for a vertical frame becomes a narrow strip down
 * the middle of a landscape one, correct in every proportion and useless for its purpose.
 *
 * The fix is to change the two numbers in the root's inline style after fetching, before
 * `write_composition`. Stretching the item's layout to the full frame instead *would* distort
 * it, so reach for the size, not the box.
 *
 * (An earlier version of this comment said a landscape project would squash a vertical
 * template. It does not. The note is kept because the wrong version was written from reasoning
 * about the resize call and the right one from placing a template and reading the box back.)
 */

export interface TemplateVariableSpec {
  id: string
  type: 'string' | 'number' | 'color' | 'boolean' | 'enum'
  label: string
}

export interface TemplateSpec {
  /** Also the `data-composition-id` inside the file, and the last segment of its uri. */
  id: string
  name: string
  description: string
  /** What it is for, so a listing can group without parsing descriptions. */
  category: 'caption' | 'identity' | 'emphasis' | 'structure'
  durationSeconds: number
  width: number
  height: number
  variables: readonly TemplateVariableSpec[]
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
      { id: 'text', type: 'string', label: 'Subtitle' },
      { id: 'size', type: 'number', label: 'Text size' },
      { id: 'bottom', type: 'number', label: 'Distance from bottom' },
      { id: 'ink', type: 'color', label: 'Text' },
      { id: 'pill', type: 'boolean', label: 'Dark pill behind' }
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
      { id: 'name', type: 'string', label: 'Name' },
      { id: 'role', type: 'string', label: 'Role' },
      { id: 'accent', type: 'color', label: 'Accent' },
      { id: 'bottom', type: 'number', label: 'Distance from bottom' }
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
      { id: 'kicker', type: 'string', label: 'Kicker' },
      { id: 'title', type: 'string', label: 'Title' },
      { id: 'accent', type: 'color', label: 'Kicker colour' },
      { id: 'scrim', type: 'number', label: 'Scrim strength' }
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
      { id: 'text', type: 'string', label: 'Label' },
      { id: 'accent', type: 'color', label: 'Border' },
      { id: 'x', type: 'number', label: 'X from left' },
      { id: 'y', type: 'number', label: 'Y from top' }
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
      { id: 'to', type: 'number', label: 'Count to' },
      { id: 'caption', type: 'string', label: 'Caption' },
      { id: 'ink', type: 'color', label: 'Number' },
      { id: 'y', type: 'number', label: 'Y from top' }
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
      { id: 'accent', type: 'color', label: 'Fill' },
      { id: 'thickness', type: 'number', label: 'Thickness' },
      { id: 'top', type: 'number', label: 'Y from top' }
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
      { id: 'line', type: 'string', label: 'Call to action' },
      { id: 'handle', type: 'string', label: 'Handle' },
      { id: 'accent', type: 'color', label: 'Accent' }
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
