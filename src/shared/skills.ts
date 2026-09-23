/**
 * bay's agent skills: real Claude Code skills, in the in-app agent's session.
 *
 * One definition, two consumers. Main writes each one as `.claude/skills/<slug>/SKILL.md` in the
 * agent's working directory before a conversation starts, and the CLI — run with project
 * settings from that directory — loads them as it loads any project's skills. The composer offers
 * the same list under `/`: choosing one puts `/<slug>` at the front of the message, the user types
 * what they want after it, and the CLI expands the skill with that text as its argument. The way
 * Claude Code works in a terminal, rather than pasting a paragraph the user then has to edit.
 *
 * Skills are invoked by the user, never by the model on its own: the agent has no `Skill` tool
 * (it has no built-in tools at all), and the CLI expands a `/skill` typed at the start of a
 * message without one — measured, not assumed.
 *
 * Each body is written to the agent. It names bay's tools, keeps to what they can do, and repeats
 * the one rule that matters inside bay: propose before editing, then check the picture.
 */

export interface BaySkill {
  /** The `/name`: lowercase, digits and hyphens — the CLI's rule for a skill name. */
  slug: string
  /** How the composer and the starter cards name it. */
  title: string
  /** What the CLI shows the model about when to use it. One sentence, "Use when…". */
  description: string
  /** The instructions the agent follows. `$ARGUMENTS` is not used: the user's text follows. */
  body: string
}

const PROPOSE =
  'Nothing changes until the user approves: gather what you need with the read tools, then call ' +
  'propose_edit with the exact calls and end your turn. After the approved calls run, look at the ' +
  'result with preview_frame before you report it done.'

export const BAY_SKILLS: readonly BaySkill[] = [
  {
    slug: 'talking-head',
    title: 'Talking Head Editing',
    description: 'Use when the user wants a talking-head or interview recording tightened: pauses, false starts and repeated lines removed.',
    body: [
      'Tighten a talking-head recording without changing what is said.',
      '',
      '1. Read the timeline with read_project (or read_script for many clips). If there are pinned time ranges, work only inside them.',
      '2. Find long pauses, false starts and repeated takes. You cannot hear audio: say so, and ask the user to point at the moments, or to give you a transcript with timings, rather than guessing from picture alone.',
      '3. Cut with remove_range so every track stays in sync. Leave a natural breath (about 6–10 frames) between sentences; never jump-cut every gap.',
      '4. Propose all the cuts as one plan, listing each range and why.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'captions',
    title: 'Captions',
    description: 'Use when the user wants captions or subtitles added, from an SRT/WebVTT file or from lines they give you.',
    body: [
      'Add readable captions.',
      '',
      '1. Ask whether the user has an SRT or WebVTT file, or will give lines and timings. Do not transcribe audio yourself — you cannot hear it.',
      '2. Keep each caption short enough to read in its time on screen (about 15–17 characters per second at most); split long lines.',
      '3. Use add_captions (cues or srt). It places them on their own track, as one undo step.',
      '4. Check two or three frames with preview_frame so no caption covers a face or other text.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'lower-third',
    title: 'Lower Third',
    description: 'Use when the user wants a name-and-role lower third introducing someone on screen.',
    body: [
      'Introduce the person on screen with a lower third.',
      '',
      '1. Ask for their name and role, and a brand colour if there is one.',
      '2. Place it with add_template (templateId "lower-third") on its own track, when the person first appears, for about 4 seconds.',
      '3. Check a frame mid-way with preview_frame: it must not cover their face or existing captions.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'motion-graphics',
    title: 'Motion Graphics',
    description: 'Use when the user wants a custom animated graphic, title, chart or explainer element designed for the video.',
    body: [
      'Design a motion graphic with the user, then build it.',
      '',
      '1. Decide together what the graphic must communicate in one sentence. Collect the actual content (words, numbers) and any brand or style cues. Ask; do not invent content.',
      '2. Read bay://guide/composition/contract before writing anything — its rules produce a wrong picture, not an error, when broken.',
      '3. Prefer a template (add_template) when one fits. Otherwise write the HTML with write_composition: one paused GSAP timeline, a sized root, a declared duration, nothing loaded over the network.',
      '4. Check read_composition for faults, propose placing it, then look at frames at its start, middle and end with preview_frame.',
      '5. Walk the user through what you made and iterate on their feedback.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'opening-title',
    title: 'Opening Title',
    description: 'Use when the user wants an opening title card at the start of the video.',
    body: [
      'Open the video with a title card.',
      '',
      '1. Ask for the title and an optional short kicker line above it.',
      '2. Place it at frame 0 with add_template (templateId "title-card"), sized to the canvas.',
      '3. Show the user a frame of it with preview_frame.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'rough-cut',
    title: 'Rough Cut from Clips',
    description: 'Use when the user wants a first assembly made from the clips they imported.',
    body: [
      'Assemble a rough cut from imported clips.',
      '',
      '1. Look at the media pool with browse_assets, and at a frame of each clip (place-and-preview only after approval). Ask what the video is about and roughly how long it should be.',
      '2. Propose an order and approximate in/out points, clip by clip, with a sentence on why.',
      '3. Lay the clips out end to end with place_asset and edit_item. Leave fine timing for later passes.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'transitions',
    title: 'Polish with Transitions',
    description: 'Use when the user wants the cuts polished with dissolves, dips or fades.',
    body: [
      'Polish the cuts.',
      '',
      '1. List the edit points (read_project). For each, suggest a straight cut, a cross-dissolve or a dip to black, and why. Most cuts should stay straight.',
      '2. A transition needs footage either side of the cut; add_transition reports when it had to shorten one — tell the user.',
      '3. Fade audio in at the very start and out at the very end with edit_item fades.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'end-card',
    title: 'End Card',
    description: 'Use when the user wants a closing end card with a call to action.',
    body: [
      'Close the video with an end card.',
      '',
      '1. Ask for the call to action and the handle or URL to show.',
      '2. Place it over the last few seconds with add_template (templateId "end-card").',
      '3. Show a frame of it with preview_frame.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'chapters',
    title: 'Chapter Markers',
    description: 'Use when the user wants chapter markers at the points where the topic changes.',
    body: [
      'Mark the chapters.',
      '',
      '1. You cannot hear the audio: ask the user for the topics and roughly where each starts, or for a transcript with timings.',
      '2. Propose a labelled marker for each chapter start (add_marker), with the timecodes.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'review',
    title: 'Review My Edit',
    description: 'Use when the user wants feedback on their edit without anything being changed.',
    body: [
      'Review the edit. Change nothing.',
      '',
      'Look at frames across the timeline with preview_frame — the start, each cut, the end — and read the structure with read_project. Report what works, and what feels off: framing, pacing, text that is hard to read, anything covering a face. Say plainly that you cannot hear the audio. Finish with the one change you would make first. Do not call propose_edit unless the user then asks for a change.'
    ].join('\n')
  }
]

/** The CLI's rule for a skill name: lowercase letters, digits and hyphens. */
export const SKILL_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function findSkill(slug: string): BaySkill | undefined {
  return BAY_SKILLS.find((skill) => skill.slug === slug)
}

/** A skill as the `SKILL.md` the CLI loads. */
export function skillMarkdown(skill: BaySkill): string {
  // The description is one line of YAML; a quote inside it would end the scalar early.
  const description = skill.description.replace(/"/g, "'")
  return `---\nname: ${skill.slug}\ndescription: "${description}"\n---\n\n${skill.body}\n`
}

/**
 * The skill a message starts with, and the rest of it: `/captions from my srt` → captions,
 * "from my srt". Only a known skill counts — `/etc/hosts is odd` is prose.
 */
export function leadingSkill(text: string): { skill: BaySkill; rest: string } | null {
  const match = /^\/([a-z0-9-]+)(?:\s+|$)([\s\S]*)$/.exec(text)
  if (!match) return null
  const skill = findSkill(match[1]!)
  return skill ? { skill, rest: match[2]! } : null
}

/**
 * `text` with `/<slug>` added at the end, where the user is typing — or unchanged when it is
 * already mentioned. Never moved to the front and never replacing another skill: a message can
 * name several ("with /motion-graphics and /captions"), and the agent loads each one it names.
 */
export function insertSkill(text: string, slug: string): string {
  if (skillSegments(text).some((part) => part.skill?.slug === slug)) return text
  const body = text.replace(/\s+$/, '')
  return body ? `${body} /${slug} ` : `/${slug} `
}

/**
 * A message split into its words and the bay skills it mentions, in order — for showing each
 * `/skill` as a chip where the user wrote it. Only known skills at a word start count.
 */
export function skillSegments(text: string): { text: string; skill?: BaySkill }[] {
  const parts: { text: string; skill?: BaySkill }[] = []
  let last = 0
  for (const match of text.matchAll(/(^|\s)\/([a-z0-9-]+)(?=\s|$|[.,;:!?])/g)) {
    const skill = findSkill(match[2]!)
    if (!skill) continue
    const start = match.index! + match[1]!.length
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: `/${skill.slug}`, skill })
    last = start + 1 + skill.slug.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
