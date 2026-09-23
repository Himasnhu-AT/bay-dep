/**
 * bay's agent skills: real Claude Code skills, in the in-app agent's session.
 *
 * One definition, two consumers. Main writes each one as `.claude/skills/<slug>/SKILL.md` in the
 * agent's working directory before a conversation starts, and the CLI — run with project
 * settings from that directory — loads them as it loads any project's skills. The composer offers
 * the same list under `/`: choosing one inserts `/<slug>` where the user is typing, and a message
 * may name several. The agent loads each one it names with the `Skill` tool — the only built-in it
 * has besides the resource readers, allowed only as `Skill(<slug>)` for these slugs (see
 * `src/main/agent/cli.ts`) — because the CLI itself expands only a `/skill` at the very start.
 *
 * Skills are invoked by the user, never by the model on its own: the system prompt tells it to
 * load only the ones the user names.
 *
 * Each body is written to the agent. It names bay's tools, keeps to what they can do, and repeats
 * the one rule that matters inside bay: make the edit directly (the user gets a diff and a
 * Revert; propose only if "Ask before editing" refuses the write), then check the picture.
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
  'Make the edits directly — bay shows the user a diff of everything you changed and they can ' +
  'revert it. (If a write is refused because the user turned on "Ask before editing", propose ' +
  'with propose_edit and wait instead.) Look at the result with preview_frame before you report ' +
  'it done.'

export const BAY_SKILLS: readonly BaySkill[] = [
  {
    slug: 'talking-head',
    title: 'Talking Head Editing',
    description: 'Use when the user wants a talking-head or interview recording tightened: pauses, false starts and repeated lines removed.',
    body: [
      'Tighten a talking-head recording without changing what is said.',
      '',
      '1. Read the timeline with read_project (or read_script for many clips). If there are pinned time ranges, work only inside them.',
      '2. Find long pauses, false starts and repeated takes from the words and their timings: call transcribe with the clip\'s itemId (it runs locally) — gaps between lines are the pauses, repeated lines are the retakes. Say what you found before cutting.',
      '3. Cut with remove_range so every track stays in sync. Leave a natural breath (about 6–10 frames) between sentences; never jump-cut every gap.',
      '4. Make the cuts, then list each range you removed and why.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'captions',
    title: 'Captions',
    description: 'Use when the user wants captions or subtitles added — from an SRT/WebVTT file, from lines they give you, or by transcribing the speech on this Mac.',
    body: [
      'Add readable captions.',
      '',
      '1. Before doing anything else, ask the user whether they have a transcript or subtitle file (SRT or WebVTT) for this video, and end your turn to wait for the answer. Skip the question only if their message already answers it — they attached or pinned a subtitle file, or said to transcribe. If they have one, use it with add_captions (srt): their words are better than a transcription.',
      '2. If they do not, transcribe the speech on this Mac with the transcribe tool, passing the clip\'s itemId: it runs whisper.cpp locally (nothing is uploaded) and returns cues already on the timeline. Tell the user you are doing this. The first transcription may download a speech model first, which takes a minute or two; say so if it is slow. If transcribe says whisper.cpp or a model is missing, pass its instructions on exactly; never invent words.',
      '3. Keep each caption short enough to read in its time on screen (about 15–17 characters per second at most); transcribe already splits lines to about 42 characters.',
      '4. Place them with add_captions (cues). It puts them on their own track, as one undo step.',
      '5. Check two or three frames with preview_frame so no caption covers a face or other text.',
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
      '4. Check read_composition for faults, place it, then look at frames at its start, middle and end with preview_frame.',
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
      '1. Look at the media pool with browse_assets, and at a frame of each clip. Ask what the video is about and roughly how long it should be.',
      '2. Decide an order and approximate in/out points, clip by clip, and say in a sentence why.',
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
      '1. List the edit points (read_project). For each, choose a straight cut, a cross-dissolve or a dip to black, and say why. Most cuts should stay straight.',
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
      '1. Read what is said, with timings, using transcribe on the clip (it runs locally). If the user already has a transcript, use theirs.',
      '2. Find where the topic changes and add a labelled marker at each chapter start (add_marker), then list the chapters with their timecodes.',
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
      'Look at frames across the timeline with preview_frame — the start, each cut, the end — and read the structure with read_project. Report what works, and what feels off: framing, pacing, text that is hard to read, anything covering a face. Say plainly that you cannot hear the audio. Finish with the one change you would make first. Change nothing unless the user then asks for a change.'
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
