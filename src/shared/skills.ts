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
      '1. Before doing anything else, ask the user in ONE message (then end your turn to wait): do they have a transcript or subtitle file (SRT or WebVTT) for this video, and which subtitle design they want — Spotlight (bold white, the spoken word lit sky blue; the default), Punch (outlined uppercase, one or two words, yellow pop), Boxed (dark card, coloured chip on the spoken word), Clean (whole phrases, no highlight) or Reveal (words appear as spoken). They can also pick a design in the Text panel. Skip whatever their message already answers — a pinned subtitle file, "transcribe it", a named design.',
      '2. With their file: add_captions (srt). Their words are better than a transcription; it places plain lines.',
      '3. Without one: add_subtitles with the clip\'s itemId and the chosen style. It transcribes on this Mac with whisper.cpp (nothing is uploaded), times every word, and places word-by-word subtitles over the clip as one undo step; calling it again with another style swaps the design. Tell the user you are transcribing. The first run may download a speech model, which takes a minute or two; say so if it is slow. If it says whisper.cpp or a model is missing, pass its instructions on exactly; never invent words.',
      '4. Check two or three frames with preview_frame, mid-sentence, so the text never covers a face or other graphics. If it does, call add_subtitles again with bottom (percent from the bottom) or scale.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'short-form',
    title: 'Short-form Edit',
    description: 'Use when the user wants a talking-head clip turned into a vertical short, reel or TikTok: word-by-word subtitles and story graphics that keep viewers watching.',
    body: [
      'Turn a talking-head recording into a vertical short in bay\'s short-form grammar: the speaker fills a 9:16 frame, word-by-word subtitles sit in the lower third, and one graphic at a time in a band across the top carries the story beat being spoken.',
      '',
      '1. Read the timeline (read_project). If the canvas is not 1080×1920, call set_canvas { preset: "vertical-1080", fit: "cover" } so the speaker fills the frame. Check a frame with preview_frame: the face should sit in the middle third, with room above the head for the graphics band.',
      '2. If the user has not named a subtitle design, ask once — Spotlight (the default: bold white, spoken word sky blue), Punch, Boxed, Clean or Reveal — and end your turn. Skip the question if they said "just do it" or named one.',
      '3. transcribe the clip (itemId) and read what is said. Find the beats: the hook (the first line, usually a question or a label), each claim or turn, the answer or reveal, and the closing question or call to action. Pick 4–8 moments for graphics — not every sentence.',
      '4. add_subtitles with the chosen style over the clip.',
      '5. Write ONE .brf module (write_brf — JSX like React/Remotion; bay://guide/brf has a top-band example to start from) covering the whole clip, for the top band. It draws one element at a time, each appearing on the word it names (use the transcript times, in seconds from the clip start) and leaving before the next: keep every element in the top quarter of the frame, over a dark gradient that fades from about 55% black at the top edge to clear, so it reads over any background. Use these elements, with the words copied verbatim from what is said and kept short:',
      '   - Label: one bold uppercase word in red (#EF4B3C) for the topic, at the hook ("OVERTHINKER").',
      '   - Stack: short chips that pile up one per item as each is said (dark translucent chip, thin red outline); the last, the punchline, slightly larger ("you" / "your friend" / "the top person in your list" / "everyone").',
      '   - Reveal: a small, widely spaced red kicker over a heavy two-line white headline, for an answer or a turn ("THE ANSWER" / "TOO MUCH INPUT").',
      '   - Key phrase: a short phrase with its key word in sky blue (#8EC8FF) ("CRITICAL thinking").',
      '   - Choice: two stacked rows with a coloured left edge, red then blue, for a closing either/or; the one being said is bright and the other dimmed ("consuming too much?" / "or thinking too much?").',
      '   Entrances are quick (about 0.2 s: in={[\'up\', 0.2]}); nothing loops or wobbles. Give each element a t={[start, end]} window in seconds from the clip start, or build the beats from an array in code. Leave out size so it lays out on the 9:16 canvas. Place it in the same call with atFrame at the clip\'s first frame; it lands on a track with room above the video.',
      '6. Check a frame at each graphic with preview_frame: the band must clear the top of the head and never touch the subtitles; the subtitles must sit below the chin. If anything collides, read_brf, fix it, and write_brf with the same assetId.',
      '7. Tell the user what you added, beat by beat, and offer to export (export_timeline, mp4, 1080×1920).',
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
      '2. Build it with write_brf: a JSX module written like React or Remotion (interpolate, spring, useCurrentFrame, Sequence, components, loops over data) that bay draws natively — bay://guide/brf has the elements and worked examples. It is run across its whole duration before anything changes, and an error comes back with its line and frame. Put the words and colours the user may change in export const vars.',
      '3. Only if it needs a web page (CSS layout, embedded video, a JS library) write HTML with write_composition instead, after reading bay://guide/composition/contract.',
      '4. Place it (atFrame in the same write_brf call), then look at frames at its start, mid-entrance, at rest and mid-exit with preview_frame.',
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
    slug: 'highlights',
    title: 'Find Highlights',
    description: 'Use when the user wants the best moments of a long talk, podcast or interview found — marked on the timeline, cut into a highlight reel, or pulled out as shorts.',
    body: [
      'Find the moments in a long recording that work as short clips on their own, and mark or cut them.',
      '',
      '1. Read the timeline (read_project) and find the speech clip. If the user named a length, a number of clips or a focus (viral moments, or complete knowledge points), use it; otherwise 3 clips of 30–60 seconds, balanced. If they pinned a time range, work only inside it.',
      '2. Call find_highlights with the clip\'s itemId (and fromFrame/toFrame for a range, and focus, genre, count, minSeconds, maxSeconds). It transcribes on this Mac if needed (reusing a transcript from this session) and returns numbered sentences with their frames, plus the rubric. Tell the user if it is transcribing; a first run may download a speech model.',
      '3. Read the sentences and choose clips yourself. Each starts on a sentence\'s fromFrame and ends on the same or a later sentence\'s toFrame, opens on the start of a thought, lands its point, and makes sense to someone who never saw the rest. Score each 0–100 on hook, information, emotion and completeness, honestly, and keep only the strongest — fewer good clips beat padding.',
      '4. Check your picks before placing anything: no two overlap, each lies inside the bounds find_highlights gave, and each length is within the target. mark_highlights checks the same things and refuses with every fault listed — fix exactly those and call again.',
      '5. Call mark_highlights with the picks, their scores and a one-line reason each, plus the focus and minSeconds/maxSeconds. It places a start and end marker per clip, ranked by score.',
      '6. List the clips for the user: rank, title, timecodes, length, score and why it works. Then do what they asked for:',
      '   - Markers only: stop here.',
      '   - A highlight reel on this timeline: remove_range each gap between the picks, starting from the last gap so earlier frames do not move, then the head and tail. Check the joins with preview_frame.',
      '   - Separate shorts: export_timeline each range (its toFrame is inclusive, so pass the pick\'s toFrame − 1), or suggest /short-form for a vertical version.',
      '',
      PROPOSE
    ].join('\n')
  },
  {
    slug: 'dub',
    title: 'Translate & Dub',
    description: 'Use when the user wants a video translated and dubbed into another language — a voiced translation of the speech, placed in sync over the original.',
    body: [
      'Dub a speech clip into another language. You are the translator; bay gives you the cues, the time each line may take, and places the voiced lines.',
      '',
      '1. Find the speech clip with read_project. Ask the user in ONE message for anything their request leaves open, then wait: the target language, the voice model (generate_speech lists them; a key must be set in Preferences › AI providers) and voice, and whether the original should be ducked (the default), muted or kept. If they pinned a time range, work only inside it.',
      '2. Call transcribe with the clip\'s itemId (it runs on this Mac; say so if it is slow), then plan_dub with the itemId and the target language (and fromFrame/toFrame for a range). It returns cues (ids like c@120, named by the frame each starts on), each with its slot in seconds, a budget, and the rules, plus a planId.',
      '3. Translate every cue yourself, reading the three cues before and after it for context but translating only its own words. Keep the meaning, add no facts, drop fillers and stutters, and write numbers as they are said.',
      '4. Check each line that looks long with estimate_speech (language, targetSeconds = its slot). Rewrite any that run over as a shorter, natural spoken line that keeps the core meaning and adds no new facts. A small overrun is fine: bay speeds a line up a little to fit.',
      '5. Call apply_dub with validateOnly: true, the planId and all your lines. If it refuses lines as too long, shorten exactly those by the characters it names and try again. When it passes, tell the user the total estimated cost and the number of lines, and wait for their go-ahead. If it says the budget or a missing key blocks it, tell them what to change in Preferences › AI providers.',
      '6. On their go-ahead, call apply_dub without validateOnly, then track_dub with the dubId every 15–30 seconds until it says placed. Report any warnings (lines sped up past the natural range), refused or failed lines; offer to redo those with apply_dub partial: true.',
      '7. Look at the dubbed stretch with frame_grid, and say plainly that you cannot hear the audio, so the user should listen. If they want translated subtitles too, pass track_dub\'s captionCues to add_captions.',
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
      '1. Read the structure with read_project. If there is dialogue, transcribe it (itemId) so the grid shows the words.',
      '2. Watch it with frame_grid over the whole timeline (or each stretch of a long one), and go through the checklist in bay://guide/review. Look closer at anything doubtful with preview_frame.',
      '3. Report what works, and what feels off: framing, pacing, B-roll on the wrong line, text that is hard to read or covers a face, black or stray frames at cuts. Say plainly that you cannot hear the audio. Finish with the one change you would make first.',
      '',
      'Change nothing unless the user then asks for a change.'
    ].join('\n')
  }
]

/** The CLI's rule for a skill name: lowercase letters, digits and hyphens. */
export const SKILL_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

function findSkill(slug: string): BaySkill | undefined {
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
