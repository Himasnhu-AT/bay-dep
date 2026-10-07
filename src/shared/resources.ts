/**
 * The documents bay serves to an agent over MCP.
 *
 * Tools say what bay can do; resources say **how to edit video with them**. The distinction
 * matters because a tool schema can only carry what an argument is named and typed — it has
 * nowhere to put "time is frames, except `sourceStartSeconds`, which is seconds because the
 * source has a rate the timeline does not control". That sentence has to live somewhere an
 * agent can read before it starts, and a resource is that somewhere.
 *
 * Three kinds sit here. `bay://guide/editing` is bay's own, and is the one to read first.
 * `bay://guide/tools` and `bay://guide/examples` are generated from the tool catalog by
 * `./guides`, so they cannot drift from it. The
 * `bay://guide/composition/*` set is carried from the HyperFrames project (Apache-2.0) because
 * bay renders HyperFrames compositions, and an agent writing one has to satisfy the same
 * contract the renderer enforces — a second, paraphrased copy of those rules would drift from
 * the renderer on the first edit to either.
 *
 * Listed here rather than discovered from the filesystem so the catalog is a compile-time fact:
 * the bundle inlines each document, so a resource that is listed but missing is a build error
 * rather than a read that fails on a user's machine.
 */

import { TEMPLATES, templateUri } from './templates'
import { BUILT_IN_STYLES, styleMarkdown, styleUri } from './styles/index'

export interface ResourceSpec {
  /** Stable across versions. An agent may cache against it. */
  uri: string
  name: string
  description: string
  mimeType: string
}

export const RESOURCES: readonly ResourceSpec[] = [
  {
    uri: 'bay://guide/editing',
    name: 'Editing video with bay',
    description:
      'Read this first. The project model, why every time is a frame index, how to remove a ' +
      'span without losing sync, how transitions need footage either side of a cut, and the ' +
      'mistakes that produce a wrong picture rather than an error.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/tools',
    name: 'Tool reference',
    description:
      'Every tool, generated from the catalog this build serves: whether it reads or writes, ' +
      'when to reach for it, and each argument with its type, bounds and choices.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/examples',
    name: 'Worked edits',
    description:
      'Whole edits as sequences of real tool calls: trimming a false start with remove_range, a ' +
      'lower third by template or by hand, a cross-dissolve, and propose_edit through approval ' +
      'to execution when the user has turned on "Ask before editing". Checked against the catalog, so none will be refused ' +
      'for its shape.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/footage-search',
    name: 'Finding a shot by what it shows',
    description:
      'Read when the user names a shot by its picture and you do not know where it is. Index ' +
      'once with index_footage, search in caption-like words with search_footage, then turn the ' +
      'hit (a moment) into the shot with detect_cuts, check it with frame_grid, and place it.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/review',
    name: 'Reviewing your own edit',
    description:
      'Read before telling the user an edit or export is done. How to watch the result with ' +
      'frame_grid, the checklist (B-roll on the right line, cues on the word, captions clear of ' +
      'faces, safe areas, audio, clean cuts and transitions), and what blocking findings mean.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/generation',
    name: 'Generating images and video',
    description:
      'Read before any generate_image or generate_video call. Stating the cost and getting the ' +
      'go-ahead, one shot per script line, sizing a clip to how long its line takes to say, what ' +
      'a reference image is for (identity, style or continuity), framing clear of captions, and ' +
      'negative constraints.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/format/talking-head',
    name: 'Format: talking head',
    description:
      'One person to camera — vlog, lesson, UGC testimony. Hook, beats and close; pause and ' +
      'breath lengths; caption placement; the tool order from transcribe to remove_range to ' +
      'subtitles; and the checks before calling it done.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/format/podcast-clip',
    name: 'Format: podcast or interview clip',
    description:
      'A vertical 20–90 s clip from a long conversation: choosing a moment that stands alone, ' +
      'reframing a landscape recording to 9:16 on the speaking face, word-by-word subtitles ' +
      'clear of mouths and platform buttons, and the checks.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/format/ranking',
    name: 'Format: ranking or listicle',
    description:
      'Top-N lists, tier lists and countdowns: reveal, reason and proof per entry, a persistent ' +
      'board built as one .brf module, reveals timed to the naming word, and the checks.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/format/ad',
    name: 'Format: product ad and UGC ad',
    description:
      'Hook, problem, proof, offer and call to action with timings for a 30 s ad; a job for ' +
      'every shot; offer and CTA as typography; real product assets only; and the checks.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/format/explainer',
    name: 'Format: explainer with B-roll',
    description:
      'Presenter-led or narration-led explainers: exact against mood B-roll, holding a cutaway on ' +
      'its word, graphics that persist across steps, caption and diagram zones, and the checks.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/brf',
    name: 'Motion graphics as .brf',
    description:
      'The .brf format write_brf takes: layers, positions and anchors, keyed animation and ' +
      'easings, entrance and exit presets, text split word by word, groups and clipping, ' +
      'variables — with complete, valid documents for a title, a lower third, a stat card and ' +
      'kinetic captions to start from.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/prompt-kits',
    name: 'Prompt kits for generation',
    description:
      'Worked-out prompts for generate_image and generate_video — B-roll, establishing shots, drone ' +
      'orbits, macro details, product heroes, text-free thumbnail backgrounds and more — each with ' +
      'its slots, what it keeps out, and a suggested model and aspect. Fill one with fill_prompt_kit.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/script',
    name: 'The Script surface',
    description:
      'The timeline as an editable markdown script: the line format read_script renders, the ' +
      'edits apply_script accepts and exactly what each one does (delete, ripple, reorder, ' +
      'move, trim, slip, retitle), what is refused, and what happens to transitions.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/contract',
    name: 'HTML compositions: the contract',
    description:
      'What makes an HTML file renderable by bay: one paused timeline, a sized root, a declared ' +
      'duration, the determinism rules, and which declared <audio> bay mixes. Read before ' +
      'writing a composition.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/minimal',
    name: 'The smallest composition that renders',
    description: 'A skeleton to start from, with the sizing that an unsized root gets wrong.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/data-attributes',
    name: 'Composition data-* attributes',
    description:
      'Every data-* attribute a composition root, clip or sub-composition host may carry, and ' +
      'what each one does.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/determinism',
    name: 'Determinism rules',
    description:
      'The bans that make a composition seekable — no render-time clocks, no unseeded random, ' +
      'no network, no infinite repeats. bay photographs a seeked page, so a composition that ' +
      'depends on anything but time renders differently every run.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/patterns',
    name: 'Composition patterns',
    description: 'Monolithic against modular, how to structure an index, and sub-comp archetypes.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/tracks-and-clips',
    name: 'Tracks and clips inside a composition',
    description:
      'What data-track-index controls and what it does not, z-order, and timing one clip ' +
      'relative to another.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/variables-and-media',
    name: 'Variables and media in a composition',
    description: 'Declaring variables, placing video and audio, setting volume, trimming.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/sub-compositions',
    name: 'Sub-compositions',
    description: 'Host attributes, the template wrapper, per-instance variables, animating inside.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/editing-recipes',
    name: 'Composition editing recipes',
    description:
      'Cut, trim, reorder, retime, freeze, camera, mask, crossfade and audio recipes — with ' +
      'their limits stated rather than implied.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/composition/full-screen-motion',
    name: 'Full-screen motion',
    description: 'Authoring full-frame motion with shared backgrounds.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bay://guide/motion-design',
    name: 'Motion design: one film, carried',
    description:
      'Read before a launch film, promo, title sequence or any graphic with more than one beat: ' +
      'how a film is planned (measure the reference, three concepts, a beat sheet of rhythm and ' +
      'carry), the rules, every move in the BM library (bay-motion.js) with which carry suits ' +
      'which boundary and the curves by t80, the window.__film contract with what each ' +
      'check_film leg fails on and where it is blind, sound with score_sfx, and a tested kit: a ' +
      'whole film on BM with a keyed camera, three carried boundaries and motion blur.',
    mimeType: 'text/markdown'
  }
] as const

/**
 * The shipped templates, as resources.
 *
 * Derived from `TEMPLATES` rather than written out again: two hand-maintained lists of the same
 * seven things is a drift waiting to happen, and the failure would be a template an agent can
 * see in one listing and cannot fetch from the other. The uri is the one `templateUri` builds,
 * so the id in the catalog and the id in the address cannot disagree.
 *
 * `text/html` rather than markdown, because the body *is* the composition: an agent fetches it,
 * edits the text or the variables, and hands it to `write_composition` unchanged in shape.
 */
const TEMPLATE_RESOURCES: readonly ResourceSpec[] = TEMPLATES.map((template) => ({
  uri: templateUri(template.id),
  name: `Template: ${template.name}`,
  description:
    `${template.description} ${template.durationSeconds}s. ` +
    `Variables: ${template.variables.map((v) => `${v.id} (${v.type})`).join(', ')}. ` +
    // The body ships at one size and lays out relative to whatever size its root is given.
    // Saying so here is what stops an agent placing the portrait file on a landscape timeline.
    `add_template places it sized to the timeline in one call. Fetched raw it is ` +
    `${template.width}x${template.height}; set the root's width and height to the canvas before ` +
    `write_composition — the layout inside is frame-relative and follows.`,
  mimeType: 'text/html'
}))

/**
 * The built-in editing styles, as resources — derived from `BUILT_IN_STYLES` like the templates,
 * so a client without the style tools still sees them. User styles are not listed: they live in
 * main's styles folder and are read through `read_style`, which checks them on the way.
 */
const STYLE_RESOURCES: readonly ResourceSpec[] = BUILT_IN_STYLES.map((style) => ({
  uri: styleUri(style.id),
  name: `Style: ${style.title}`,
  description: `${style.summary} Steps with bay's tools plus design tokens; read_style returns the same as JSON.`,
  mimeType: 'text/markdown'
}))

/** Each built-in style's resource body, by uri. */
export function styleResourceBodies(): Record<string, string> {
  return Object.fromEntries(BUILT_IN_STYLES.map((style) => [styleUri(style.id), styleMarkdown(style)]))
}

/** Everything servable over `resources/list`: the guides, then the templates, then the styles. */
export const ALL_RESOURCES: readonly ResourceSpec[] = [...RESOURCES, ...TEMPLATE_RESOURCES, ...STYLE_RESOURCES]

export function findResource(uri: string): ResourceSpec | undefined {
  return ALL_RESOURCES.find((resource) => resource.uri === uri)
}
