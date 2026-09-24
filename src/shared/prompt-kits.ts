/**
 * Prompt kits: reusable, fill-in-the-blanks prompts for `generate_image` and `generate_video`.
 *
 * A kit is wording that has already been worked out — the camera language that makes an orbit
 * read as an orbit, the clause that stops a model painting captions into a background — with the
 * few choices that change from shot to shot left as `[slot]`s. `fill_prompt_kit` turns a kit and
 * the slot values into the final text, and refuses a slot it does not know or a required one that
 * is missing, naming the valid ones. Nothing here calls a model or costs anything: the filled
 * prompt is text to read before a paid call.
 *
 * Every kit ends with things to keep out. Most name on-screen text, captions and logos, because
 * bay draws its own text over the picture and a generated caption cannot be edited or removed.
 *
 * The wording is bay's own. Where a kit follows the shape of a template in OpenCreator
 * (krillinai/OpenCreator, Apache-2.0, `template/*`), `credit` names that template and the author
 * it credits — most of those are themselves adapted from public posts, so the original author is
 * named too. Nothing from those templates is copied verbatim.
 */

import { MODELS } from './generation'

export interface PromptKitSlot {
  /** As written in the template: `[subject]` fills slot `subject`. Lowercase, underscores. */
  id: string
  description: string
  /** Absent means required: the kit cannot be filled without it. */
  default?: string
}

export interface PromptKit {
  id: string
  title: string
  kind: 'image' | 'video'
  /** When to reach for it, in one sentence. */
  use: string
  template: string
  slots: readonly PromptKitSlot[]
  /** Kept out of the picture. Image kits append it to the prompt; video kits return it as `negativePrompt`. */
  avoid: readonly string[]
  model: string
  aspectRatio: string
  durationSeconds?: number
  /**
   * The picture the kit expects as `referenceAssetId`, when it wants one. A Kling model then takes
   * its frame from that picture and refuses an `aspectRatio`, which the filled request says.
   */
  reference?: string
  credit?: { basedOn: string; author: string; url: string }
}

const NO_TEXT = 'on-screen text, captions, subtitles, logos or watermarks'

/** OpenCreator's camera-motion templates all credit the same Higgsfield article. */
const HIGGSFIELD = {
  author: 'Higgsfield.AI Team',
  url: 'https://higgsfield.ai/academy/how-to-use/turn-your-video-into-cinema-using-wan-camera-control'
}

export const PROMPT_KITS: readonly PromptKit[] = [
  {
    id: 'broll-cutaway',
    title: 'B-roll cutaway',
    kind: 'video',
    use: 'A short cutaway to lay over speech when the words name something the viewer should see.',
    template:
      'A short documentary-style cutaway of [subject] [action] in [setting]. The camera [camera]. ' +
      '[light]. Real textures and believable scale; the action is already under way when the shot ' +
      'begins and still going when it ends, so it can be cut anywhere.',
    slots: [
      { id: 'subject', description: 'Who or what is on screen, concretely ("a barista", "a bike courier").' },
      { id: 'action', description: 'What they are doing, as a continuing activity ("pouring milk into a flat white").' },
      { id: 'setting', description: 'Where, with one or two telling details.', default: 'a small, lived-in space' },
      { id: 'camera', description: 'One camera behaviour.', default: 'holds steady at eye level with a slow drift in' },
      { id: 'light', description: 'The light.', default: 'Soft natural window light' }
    ],
    avoid: [NO_TEXT, 'people looking into the lens', 'jump cuts or scene changes inside the clip'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 6
  },
  {
    id: 'establishing-shot',
    title: 'Establishing shot',
    kind: 'video',
    use: 'Open a section by showing where it happens before anyone speaks.',
    template:
      'A wide establishing shot of [place] at [time_of_day]. [weather]. The camera [camera], giving ' +
      'the viewer time to take in the layout of the place. Small signs of life in the distance — ' +
      '[life] — but no one close to the lens.',
    slots: [
      { id: 'place', description: 'The location, specifically ("a harbour town on a rocky coast").' },
      { id: 'time_of_day', description: 'When.', default: 'early morning' },
      { id: 'weather', description: 'Sky and air.', default: 'Clear air with a little haze on the horizon' },
      { id: 'camera', description: 'One slow move.', default: 'pans slowly from left to right on a tripod' },
      { id: 'life', description: 'Movement far away.', default: 'a few people walking, a car passing' }
    ],
    avoid: [NO_TEXT, 'recognisable landmarks or real brand signage', 'fast camera moves'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 8
  },
  {
    id: 'drone-orbit',
    title: 'Drone orbit',
    kind: 'video',
    use: 'Make a subject or place feel important with one steady circle around it.',
    template:
      'A drone circles [subject] at a constant speed and a constant height of about [height] metres, ' +
      'staying about [radius] metres away and travelling to the screen [direction], covering about a ' +
      'third of a full circle. The subject stays centred while the background sweeps past behind it. ' +
      'The height, the distance and the speed never change.',
    slots: [
      { id: 'subject', description: 'What the camera circles.' },
      { id: 'height', description: 'Height in metres.', default: '4' },
      { id: 'radius', description: 'Distance from the subject in metres.', default: '8' },
      { id: 'direction', description: '"left" or "right".', default: 'right' }
    ],
    avoid: [NO_TEXT, 'zooming', 'climbing or dropping', 'speed changes', 'cuts'],
    model: 'veo-3.1-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 8,
    credit: { basedOn: 'OpenCreator template drone-orbit-subject', ...HIGGSFIELD }
  },
  {
    id: 'aerial-pullback-reveal',
    title: 'Aerial pull-back reveal',
    kind: 'video',
    use: 'End a section by pulling away from a subject until its surroundings tell the story.',
    template:
      'The shot opens close on [subject], a few metres away and just above it. In one continuous, ' +
      'gradually accelerating move the camera flies backwards and upwards until [subject] is small ' +
      'in the middle of [surroundings]. The subject stays centred the whole time and the horizon ' +
      'rises steadily through the frame.',
    slots: [
      { id: 'subject', description: 'What the shot starts on.' },
      { id: 'surroundings', description: 'What is revealed around it ("a dry salt flat reaching to the mountains").' }
    ],
    avoid: [NO_TEXT, 'orbiting', 'zooming', 'the move reversing or stopping'],
    model: 'veo-3.1-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 8,
    credit: { basedOn: 'OpenCreator template aerial-pullback-rise-reveal', ...HIGGSFIELD }
  },
  {
    id: 'crane-rise-reveal',
    title: 'Crane rise',
    kind: 'video',
    use: 'Lift from a person or object to show the scale of the place around them.',
    template:
      'A smooth crane move rising from about head height to high above [subject], tilting down ' +
      'gently as it rises so that [subject] stays in the lower third of the frame while [place] ' +
      'opens up around them. It eases to a stop and holds on the high view.',
    slots: [
      { id: 'subject', description: 'Who or what the shot keeps in frame.' },
      { id: 'place', description: 'What the rise reveals.' }
    ],
    avoid: [NO_TEXT, 'sideways movement', 'orbiting', 'zooming', 'speed ramps'],
    model: 'veo-3.1-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 8,
    credit: { basedOn: 'OpenCreator template vertical-crane-reveal', ...HIGGSFIELD }
  },
  {
    id: 'rack-focus',
    title: 'Rack focus',
    kind: 'video',
    use: 'Shift attention from one thing to another without cutting.',
    template:
      'A locked-off shot on a tripod. Focus starts on [far], with [near] a soft blur in the ' +
      'foreground, then pulls slowly and once to [near], leaving [far] melted into soft bokeh. ' +
      'Only the focus changes; the framing never does.',
    slots: [
      { id: 'far', description: 'What is sharp first, further from the lens.' },
      { id: 'near', description: 'What is sharp at the end, closer to the lens.' }
    ],
    avoid: [NO_TEXT, 'camera movement of any kind', 'focus hunting back and forth'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 6,
    credit: { basedOn: 'OpenCreator template rack-focus-foreground-background', ...HIGGSFIELD }
  },
  {
    id: 'macro-detail',
    title: 'Macro detail',
    kind: 'video',
    use: 'An insert of texture or craft — the grain of a product, a mechanism moving — to cut to on a detail the speaker mentions.',
    template:
      'An extreme close-up of [object], filling the frame. The camera slides slowly across [detail] ' +
      'with a very shallow depth of field, so a thin plane is sharp and everything else falls away. ' +
      '[light] picks out the surface texture.',
    slots: [
      { id: 'object', description: 'The thing, concretely.' },
      { id: 'detail', description: 'The part the camera travels over.', default: 'its surface' },
      { id: 'light', description: 'The light.', default: 'A low, warm side light' }
    ],
    avoid: [NO_TEXT, 'hands entering the frame', 'the camera pulling out to a wide shot'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 6
  },
  {
    id: 'product-turntable',
    title: 'Product turntable',
    kind: 'video',
    use: 'Show a product from every side for an ad or a feature beat.',
    reference: 'A clean photo of the product, so its shape and label stay accurate. Optional but strongly advised.',
    template:
      '[product] turns slowly on a hidden turntable against [backdrop], completing about half a ' +
      'turn. Studio lighting with a soft key light and a crisp rim that traces its edges; clean ' +
      'reflections on the surface below. The camera does not move. Keep the product\'s shape, ' +
      'colours, materials and label placement exactly as in the reference.',
    slots: [
      { id: 'product', description: 'The product, as you would describe it to a photographer.' },
      { id: 'backdrop', description: 'The background.', default: 'a seamless mid-grey backdrop' }
    ],
    avoid: [NO_TEXT, 'invented labels or packaging text', 'the product changing shape', 'hands'],
    model: 'kling-v2-6',
    aspectRatio: '16:9',
    durationSeconds: 5
  },
  {
    id: 'transition-plate',
    title: 'Transition plate',
    kind: 'video',
    use: 'A full-frame abstract plate to cut or dissolve through between sections.',
    template:
      'A full-frame abstract plate with no subject: [texture] moving [direction] at a steady pace, ' +
      'in [palette]. It fills the whole frame from the first frame to the last, with no edges, ' +
      'horizon or focal point, so it can sit between any two shots.',
    slots: [
      { id: 'texture', description: 'What moves ("soft ink clouds", "light leaks", "drifting smoke").' },
      { id: 'direction', description: 'Which way.', default: 'from left to right' },
      { id: 'palette', description: 'Colours — match the edit\'s grade.', default: 'warm amber and deep teal' }
    ],
    avoid: [NO_TEXT, 'people, objects or recognisable shapes', 'flashing or strobing'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '16:9',
    durationSeconds: 4
  },
  {
    id: 'animate-still',
    title: 'Animate a still',
    kind: 'video',
    use: 'Bring an illustration, poster or photo to life with small movements.',
    reference: 'The picture to animate. Required: the prompt describes it as the first frame.',
    template:
      'Use the reference picture as the first frame and keep it exactly: the same composition, ' +
      'colours, line work and style. The camera stays completely still. Only a few small parts move ' +
      'gently and repeatedly — [motion] — and everything else, including any lettering, stays ' +
      'perfectly still. The clip ends close to where it began, so it can loop.',
    slots: [
      { id: 'motion', description: 'The few things that move, taken from what is actually in the picture ("steam rising from the cup, a cat blinking").' }
    ],
    avoid: ['new characters or objects', 'the style changing to photographic or 3D', 'warped or redrawn lettering', 'camera moves'],
    model: 'kling-v2-6',
    aspectRatio: '9:16',
    durationSeconds: 5,
    credit: {
      basedOn: 'OpenCreator template retro-illustration-micro-motion',
      author: '小洁AI实战',
      url: 'https://www.douyin.com/video/7624869691328485361'
    }
  },
  {
    id: 'ugc-phone-clip',
    title: 'Phone-camera clip',
    kind: 'video',
    use: 'Footage that should look like a person filmed it on their phone — social ads, reactions, "day in the life".',
    template:
      'Vertical footage that looks filmed on a phone held by [holder]: slight natural hand shake, ' +
      'the phone\'s everyday exposure and colour, the background in focus rather than blurred. ' +
      '[person] [activity] in [setting]. Natural light, unretouched skin, nothing staged-looking.',
    slots: [
      { id: 'person', description: 'Who, with one or two distinguishing details.' },
      { id: 'activity', description: 'What they are doing, as a continuing action.' },
      { id: 'setting', description: 'Where.', default: 'their own kitchen' },
      { id: 'holder', description: 'Who holds the phone.', default: 'the person themselves, at arm\'s length' }
    ],
    avoid: [NO_TEXT, 'cinematic depth of field', 'studio lighting', 'phone interface elements on screen'],
    model: 'veo-3.1-fast-generate-preview',
    aspectRatio: '9:16',
    durationSeconds: 6
  },
  {
    id: 'product-hero-still',
    title: 'Product hero image',
    kind: 'image',
    use: 'A bold key visual of one product, for an ad, an end card or a thumbnail.',
    reference: 'A clean photo of the product, so its shape and label stay accurate. Optional but strongly advised.',
    template:
      'A bright, high-energy product key visual. [product] stands in the centre, sharp and ' +
      'perfectly lit, with [elements] bursting outwards around it. Behind it, a clean [color] ' +
      'background with one large simple shape in the same family of colours. Vivid studio light, ' +
      'crisp reflections, saturated colour. The finished design fills the whole canvas. Keep the ' +
      'product\'s shape, colours and label placement exactly as in the reference.',
    slots: [
      { id: 'product', description: 'The product.' },
      { id: 'elements', description: 'What flies around it ("ice shards and water droplets", "fresh citrus slices").' },
      { id: 'color', description: 'The background colour.', default: 'saturated orange' }
    ],
    avoid: [NO_TEXT, 'a photo of a poster on a wall or a mockup on a table', 'invented label text'],
    model: 'gemini-3-pro-image',
    aspectRatio: '16:9',
    credit: {
      basedOn: 'OpenCreator template beverage-food-marketing-hero',
      author: '@AI Guide-Note',
      url: 'https://x.com/AIGuideNote/status/2097040165009252374'
    }
  },
  {
    id: 'talking-head-background',
    title: 'Talking-head background',
    kind: 'image',
    use: 'An empty set to key a speaker over, or a backdrop behind a talking head.',
    template:
      'An empty [room], photographed at seated eye height with a normal lens. Nobody is in it. ' +
      'The [side] half of the frame is clear, calm and slightly darker, where a person will be ' +
      'placed later; the other half holds [props]. [light]. Gentle depth: the back wall a little ' +
      'soft, nothing busy directly behind where the head will be.',
    slots: [
      { id: 'room', description: 'The kind of space ("home office with bookshelves", "small recording studio").' },
      { id: 'side', description: 'Where the speaker will go: "left", "right" or "centre".', default: 'left' },
      { id: 'props', description: 'Two or three objects that say who the speaker is.', default: 'a plant, a shelf of books and a warm lamp' },
      { id: 'light', description: 'The light.', default: 'Soft daylight from a window out of frame, with a warm practical lamp' }
    ],
    avoid: [NO_TEXT, 'people', 'screens showing readable content'],
    model: 'gemini-3-pro-image',
    aspectRatio: '16:9'
  },
  {
    id: 'thumbnail-background',
    title: 'Thumbnail background (text-free)',
    kind: 'image',
    use: 'A thumbnail picture with room left for a title bay draws on top — the text stays editable.',
    template:
      'A striking, high-contrast video thumbnail picture with no lettering. On the [subject_side] ' +
      'half, [subject], close and sharp, lit dramatically against the background. The other half ' +
      'is a clean, fairly empty field of [field] where a headline will be added later. Saturated ' +
      'colour, crisp edges, a clear single focal point that reads at a small size.',
    slots: [
      { id: 'subject', description: 'The person or thing, with its expression or pose.' },
      { id: 'subject_side', description: '"left" or "right".', default: 'right' },
      { id: 'field', description: 'The empty half.', default: 'dark navy fading to black' }
    ],
    avoid: [NO_TEXT, 'arrows, badges, emoji or graphic stickers', 'a cluttered background'],
    model: 'gemini-3-pro-image',
    aspectRatio: '16:9',
    credit: {
      basedOn: 'OpenCreator template tech-product-review-thumbnail (its split layout, without the text)',
      author: '@BLCNYY',
      url: 'https://x.com/BLCNYY/status/2090897198351368575'
    }
  },
  {
    id: 'ugc-phone-still',
    title: 'Phone-camera photo',
    kind: 'image',
    use: 'A still that should look like an ordinary phone snapshot — a reference frame for a UGC-style video, or a social post.',
    template:
      'An everyday phone photo, not a professional shoot: the background clearly visible and in ' +
      'focus, natural light, true skin texture, the colour a phone produces on its own. [person], ' +
      '[pose], in [setting]. Framed [framing].',
    slots: [
      { id: 'person', description: 'Who, with their age and one or two distinguishing details.' },
      { id: 'pose', description: 'What they are in the middle of doing — an action a video could continue.', default: 'mid-sentence, one hand gesturing' },
      { id: 'setting', description: 'Where, with two or three telling objects.' },
      { id: 'framing', description: 'Where they sit in the frame and how much of them shows.', default: 'from the waist up, a little right of centre' }
    ],
    avoid: [NO_TEXT, 'studio lighting', 'blurred background', 'retouched, plastic-looking skin'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '9:16'
  }
]

const SLOT = /\[([a-z][a-z0-9_]*)\]/g

export function findPromptKit(id: string): PromptKit | undefined {
  return PROMPT_KITS.find((kit) => kit.id === id)
}

/** What `generate_image`/`generate_video` take, ready to pass (add referenceAssetId yourself). */
export interface KitRequest {
  model: string
  prompt: string
  negativePrompt?: string
  /** Absent when a reference picture decides the frame (Kling with `withReference`). */
  aspectRatio?: string
  durationSeconds?: number
}

export type FilledKit =
  | {
      ok: true
      kit: string
      kind: PromptKit['kind']
      /** Which tool takes `request`. */
      tool: 'generate_image' | 'generate_video'
      request: KitRequest
      defaultsApplied: string[]
      reference?: string
      credit?: PromptKit['credit']
    }
  | { ok: false; error: string }

/** A kit's template with the slot values in, or why it cannot be filled — naming what can. */
export function fillPromptKit(
  id: string,
  values: Record<string, unknown> = {},
  options: { withReference?: boolean } = {}
): FilledKit {
  const kit = findPromptKit(id)
  if (!kit) {
    return { ok: false, error: `There is no prompt kit "${id}". Kits: ${PROMPT_KITS.map((k) => k.id).join(', ')}.` }
  }
  const known = kit.slots.map((s) => s.id)
  const describe = (): string =>
    kit.slots.map((s) => `${s.id}${s.default === undefined ? ' (required)' : ` (default "${s.default}")`}`).join(', ')
  const unknown = Object.keys(values).filter((key) => !known.includes(key))
  if (unknown.length > 0) {
    return { ok: false, error: `Kit "${kit.id}" has no slot ${unknown.map((u) => `"${u}"`).join(', ')}. Its slots: ${describe()}.` }
  }
  const notText = Object.entries(values).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)
  if (notText.length > 0) {
    return { ok: false, error: `Slot ${notText.map((k) => `"${k}"`).join(', ')} must be non-empty text. Omit a slot to use its default.` }
  }
  const missing = kit.slots.filter((s) => s.default === undefined && values[s.id] === undefined).map((s) => s.id)
  if (missing.length > 0) {
    return { ok: false, error: `Kit "${kit.id}" needs ${missing.map((m) => `"${m}"`).join(', ')}. Its slots: ${describe()}.` }
  }
  const defaultsApplied = kit.slots.filter((s) => values[s.id] === undefined).map((s) => s.id)
  const valueOf = (slot: string): string => {
    const given = values[slot]
    return typeof given === 'string' ? given.trim() : (kit.slots.find((s) => s.id === slot)?.default ?? '')
  }
  const body = kit.template.replace(SLOT, (_match, slot: string) => valueOf(slot))
  const avoid = kit.avoid.join('; ')
  // A model with a negative-prompt field gets the exclusions there; one without gets them in words.
  const model = MODELS.find((m) => m.id === kit.model)
  const negativeField = model?.negativePrompt === true
  // With a reference picture a Kling model takes the frame from it and refuses an aspect ratio.
  const aspect = options.withReference === true && model?.aspectFromReference === true ? {} : { aspectRatio: kit.aspectRatio }
  return {
    ok: true,
    kit: kit.id,
    kind: kit.kind,
    tool: kit.kind === 'image' ? 'generate_image' : 'generate_video',
    request: {
      model: kit.model,
      prompt: negativeField ? body : `${body} Avoid: ${avoid}.`,
      ...(negativeField ? { negativePrompt: avoid } : {}),
      ...aspect,
      ...(kit.durationSeconds !== undefined ? { durationSeconds: kit.durationSeconds } : {})
    },
    defaultsApplied,
    ...(kit.reference ? { reference: kit.reference } : {}),
    ...(kit.credit ? { credit: kit.credit } : {})
  }
}

/** The slots a template names, in order of first use — for the catalog's own consistency test. */
export function templateSlots(template: string): string[] {
  const seen: string[] = []
  for (const match of template.matchAll(SLOT)) if (!seen.includes(match[1]!)) seen.push(match[1]!)
  return seen
}

/** `bay://guide/prompt-kits`, rendered from `PROMPT_KITS` so the guide cannot drift from the tool. */
export function promptKitsGuide(): string {
  const lines = [
    '# Prompt kits',
    '',
    'Fill-in-the-blanks prompts for `generate_image` and `generate_video`. Call `fill_prompt_kit` with a kit id and',
    'the slot values: it returns `tool` and a `request` ready to pass to it — the finished `prompt`, a `negativePrompt`',
    'where the model takes one, and the suggested `model`, `aspectRatio` and `durationSeconds`. It costs nothing and',
    'calls no model. Then run that tool with the request and `validateOnly: true` to check options and price before',
    'generating for real. A kit that wants a reference picture says so; pass it as `referenceAssetId`, and pass',
    '`withReference: true` to fill_prompt_kit so a Kling request leaves out the aspect ratio the picture decides.',
    '',
    'Slots in `[brackets]` are filled with plain, concrete words. A slot with a default may be left out. Match',
    '`aspectRatio` to the timeline the result will be placed on, whatever the kit suggests.',
    ''
  ]
  for (const kind of ['video', 'image'] as const) {
    lines.push(`## ${kind === 'video' ? 'Video' : 'Image'} kits`, '')
    for (const kit of PROMPT_KITS.filter((k) => k.kind === kind)) {
      lines.push(`### \`${kit.id}\` — ${kit.title}`, '', kit.use, '', `> ${kit.template}`, '')
      for (const slot of kit.slots) {
        lines.push(`- \`${slot.id}\` — ${slot.description}${slot.default === undefined ? ' **Required.**' : ` Default: "${slot.default}".`}`)
      }
      lines.push('', `Keeps out: ${kit.avoid.join('; ')}.`)
      if (kit.reference) lines.push(`Reference picture: ${kit.reference}`)
      const suggested = [`model \`${MODELS.find((m) => m.id === kit.model)?.id ?? kit.model}\``, `aspect ${kit.aspectRatio}`]
      if (kit.durationSeconds !== undefined) suggested.push(`${kit.durationSeconds}s`)
      lines.push(`Suggested: ${suggested.join(', ')}.`)
      if (kit.credit) lines.push(`Adapted from ${kit.credit.basedOn} (Apache-2.0), credited to ${kit.credit.author} — ${kit.credit.url}.`)
      lines.push('')
    }
  }
  return lines.join('\n')
}
