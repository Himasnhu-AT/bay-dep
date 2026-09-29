import type { Aspect, Pair } from "@/components/app/BeforeAfter";

/**
 * The /compare page: raw footage beside the edit bay's agent made of it, one
 * entry per editing style. The page renders `ready` entries in this order and
 * nothing else, so a `pending` entry can sit here while its edit is running.
 *
 * Every word in a ready entry is a claim about a real run (CLAUDE.md, "the
 * second rule"). Fill it from that run's own record: the prompt from the
 * message box, `did` from the tool log, the numbers from the tool results.
 * Keep the `.bay` project and the tool log with the author of the change.
 *
 * Fields:
 *
 * - `slug`: one lowercase word or hyphenated words. It names the media folder,
 *   `public/compare/<slug>/`, which `scripts/encode-compare.sh` fills:
 *   `{before,after}.av1.mp4`, `{before,after}.h264.mp4` and
 *   `{before,after}-poster.{avif,webp}`.
 * - `status`: `pending` until the media is in that folder and every field below
 *   comes from the run; then `ready`. Only `ready` entries are built into the page.
 * - `title`: the figure's heading, sentence case, what the piece is ("A news
 *   explainer from one interview").
 * - `style`: the id of the built-in style the agent applied, as in
 *   `../src/shared/styles/` (`retention-talking-head`, `news-lower-thirds`,
 *   `kinetic-typography`, `luxury-minimal`, `product-launch-film`, `ugc-ad`), or `podcast`
 *   when the agent worked from the podcast skill and its tools rather than a style.
 *   The page shows its title from `STYLE_TITLES` below.
 * - `aspect`: the edit's frame, `16:9` or `9:16`.
 * - `beforeAspect`: the raw footage's frame, when it differs from `aspect`
 *   (a 16:9 interview cut into a 9:16 short). Defaults to `aspect`.
 *   The page shows every entry as two labelled frames side by side at one
 *   height, sized so both fit one screen; there is no per-entry layout.
 * - `durationSec`: the length of both videos. They must be one length and cut
 *   on the same frames, because the page plays them on one clock.
 * - `prompt`: the exact message given to bay's agent, verbatim, typos and all, except that a
 *   home folder in a path is written as `~` (no usernames on a public page).
 * - `did`: what actually ran, in order, one line each. Start a line with the
 *   tool's name as the catalog spells it (`detect_beats`, `remove_range`) and
 *   the page sets that word in monospace; the rest of the line is plain text
 *   ("export_timeline, mastered to -14 LUFS"). A line that is not a tool call
 *   ("Graded by hand in the Color page") starts with a capital and is set plain.
 * - `credits`: every piece of third-party material in either video: `text` (the
 *   title and author), `url` (its page), `licence` (its name) and, when there is
 *   one, `licenceUrl`. Add the same rows to `CREDITS.md`.
 * - `afterSound`: true when the edit has sound worth offering ("Hear the edit").
 * - `beforeSound`: true when the raw video keeps its sound; pass `--before-audio`
 *   to the encode script as well. Off by default.
 * - `av1`: false when the encode script skipped AV1; the page then offers H.264 only.
 * - `retouched`: a sentence saying what a person changed after the agent, if
 *   anything did. Absent means nothing was touched by hand, and the page says so.
 */

export type StyleId =
  | "retention-talking-head"
  | "news-lower-thirds"
  | "kinetic-typography"
  | "luxury-minimal"
  | "product-launch-film"
  | "ugc-ad"
  | "podcast"
  | "explainer"
  | "effects";

/** The built-in styles' titles, as `../src/shared/styles/*.ts` spells them. */
export const STYLE_TITLES: Record<StyleId, string> = {
  "retention-talking-head": "Retention talking-head short",
  "news-lower-thirds": "News package with lower-thirds",
  "kinetic-typography": "Kinetic typography / lyric video",
  "luxury-minimal": "Luxury / minimal brand film",
  "product-launch-film": "Product launch film",
  "ugc-ad": "UGC ad / testimonial",
  podcast: "Podcast edit (bay's podcast skill and tools)",
  explainer: "Educational explainer with a drawboard",
  effects: "Effects: a 3D title and text behind the speaker",
};

export type Credit = { text: string; url: string; licence: string; licenceUrl?: string };

export type Comparison = {
  slug: string;
  status: "pending" | "ready";
  title: string;
  style: StyleId;
  aspect: Aspect;
  beforeAspect?: Aspect;
  durationSec: number;
  prompt: string;
  did: string[];
  credits: Credit[];
  afterSound?: boolean;
  beforeSound?: boolean;
  av1?: boolean;
  retouched?: string;
};

/** Pending entries carry this in place of copy, so nothing unfinished reads as a claim. */
const PENDING = "Pending: filled from the run's own record when the edit is exported.";

export const comparisons: Comparison[] = [
  {
    slug: "explainer-drawboard",
    status: "ready",
    title: "A selfie explanation turned into a lesson, drawn on a board as he speaks",
    style: "explainer",
    aspect: "16:9",
    durationSec: 52.8,
    prompt: "Make an educational explainer of about 60 seconds from Musuweu's video, 16:9. Use his passage from about 2:19 to 3:44, where he explains Namibia's three language families and the Bantu migration; tighten it with remove_silences and keep his words exactly as he says them. The structure: he speaks on camera to set it up, then the picture cuts to a drawboard — an HTML composition whose canvas draws the concept step by step, timed to his words while his voice continues — then back to him on camera to land it. On the drawboard, draw a simple family tree: a root for each family (Bantu, Khoisan, Germanic), branches growing as he names them, Dutch branching into Afrikaans, and an arrow sweeping down the map for the Bantu migration. Hand-drawn feel: strokes that draw themselves on, clean labels, a warm off-white board, one accent colour. Use these spellings for every label and caption, not the transcript's: Musuweu, Subiya, Namibia, Bantu, Khoisan, Germanic, Dutch, Afrikaans. Add word-by-word subtitles while he's on camera, a lower third \"Musuweu · Namibia\" at the start, and a small end credit: \"Video: Musuweu Theron Kolokwe / Wikitongues (CC BY-SA 4.0)\". When it's done and checked, export it with streaming loudness to ~/Movies/bay-rnd/explainer/after.mp4.",
    did: [
      "transcribe (English) to find his passage on Namibia's language families",
      "remove_silences, then split_at, remove_range and delete_items to tighten it to 61.8 s, dropping two whole-sentence asides; every remaining word is his, in his order",
      "write_composition for the drawboard: a canvas that draws the family tree, the map and the migration arrow stroke by stroke, timed to his words",
      "add_subtitles, then write_composition for one word-by-word layer shown only while he is on camera, with the spellings from the prompt",
      "add_template for the lower third; write_brf for the credit",
      "preview_frame and frame_grid to check the board, the subtitles and the credit",
      "export_timeline, mastered to −14 LUFS",
      "A second message asked for more of him on camera: the board now cuts away and back, resuming where it stopped, and the lower third got a dark plate",
    ],
    credits: [
      {
        text: "WIKITONGUES: Musuweu speaking English and Subiya (Musuweu Theron Kolokwe / Wikitongues)",
        url: "https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Musuweu_speaking_English_and_Subiya.webm",
        licence: "CC BY-SA 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
    ],
    afterSound: true,
    retouched:
      "Trimmed for this page to 0:06.9–0:59.6 of the agent's 61.8 s export: 4 s either side of the drawboard, with a 0.15 s sound fade at each end. Both sides are cut on the same frames; nothing else was changed.",
  },
  {
    slug: "mask-3d",
    status: "ready",
    title: "A 3D title you fly through, and words that sit behind the speaker",
    style: "effects",
    aspect: "9:16",
    durationSec: 20.3,
    prompt: "Make a 20-second vertical (1080×1920) short from James talking that shows off two effects. Pick a passage of about 18 seconds that stands on its own and has one strong key phrase. (1) Open with a 3D title: the key phrase as extruded 3D text that the camera flies through (a .brf <scene3d> with <text3d>, lights and a little fog; the camera starts far back and pushes through the letters into the shot of him), about 2.5 seconds, landing on his first word. (2) Then, while he talks, put a huge bold word BEHIND him — behind his head and shoulders, in front of the wall — using put_behind_subject, and change the word on his key words (two or three words across the clip). Keep his face fully clear. Add word-by-word subtitles low in the frame. Check the 3D frames and the masked frames with preview_frame, then export it with streaming loudness to ~/Movies/bay-rnd/mask3d/after.mp4.",
    did: [
      "find_highlights and transcribe to choose the passage about keeping Yorkshire dialect alive",
      "set_canvas to vertical 1080×1920; remove_range to cut two pauses",
      "write_brf with <scene3d> and <text3d>: KEEP DIALECT ALIVE as extruded 3D type, lit and fogged; the camera flies in and pushes through the letters",
      "write_brf for three words, YORKSHIRE, POEMS and DIALECT, each on the word he says",
      "put_behind_subject for each: Apple Vision finds him in every frame and a cut-out copy of him sits above the word, so his hair and hands pass in front of the letters",
      "add_subtitles, word by word, low in the frame",
      "export_timeline, mastered to −14 LUFS",
      "A second message asked for bigger, lower words, no guessed subtitle words and punch-ins over the two jump cuts; the agent zoomed the cut-out to match",
    ],
    credits: [
      {
        text: "James speaking West Riding Yorkshire English (Wikitongues)",
        url: "https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm",
        licence: "CC0 1.0",
        licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    ],
    afterSound: true,
  },
  {
    slug: "podcast-frisian",
    status: "ready",
    title: "A raw kitchen-table conversation cut into a one-minute podcast clip",
    style: "podcast",
    aspect: "16:9",
    durationSec: 60,
    prompt: "/podcast This is a raw two-person conversation (Stephan and Simon, speaking West Frisian) filmed in one wide shot with one mixed mic. Use bay's podcast tools rather than reading a transcript — whisper can't transcribe Frisian, so don't rely on transcription, highlights or subtitles. Run detect_footage_mode first. Then make a 60-second 16:9 clip from the liveliest stretch of the first five minutes (the source is only 1080×606, so keep punch-ins gentle, no more than about 1.5×): remove_silences so only dead air goes, level_voices so both men sit at the same loudness, and reframe so the picture follows whoever is talking (a gentle punch-in on each man, back to the two-shot now and then, cut when the voice changes; if the audio can't tell them apart, cut on the natural turns). Add a clean lower third with their names and \"speaking West Frisian\", and a small credit at the end: \"Video: Wikitongues, Guillem Belmar (CC BY-SA 4.0)\". When it's done and checked, export it with streaming loudness to ~/Movies/bay-rnd/podcast/after.mp4.",
    did: [
      "detect_footage_mode: podcast, 68% confidence",
      "Chose 1:40–2:51 of the 24-minute source, after the camera settles, where both men are most animated",
      "remove_silences: 19 gaps of half a second or more, 12.1 s in all, keeping 0.2 s of breath at each cut",
      "level_voices by stretch to −25 LUFS; with one mixed mic it evens the loudness per stretch, not strictly per speaker",
      "switch_speakers not used: one mixed mic cannot tell the two men apart, so shots cut on visible turns",
      "edit_item for 1.5× close-ups on whoever is talking, back to the two-shot for the shared laugh",
      "write_brf for the lower third and the licence credit",
      "export_timeline, mastered to −14 LUFS",
    ],
    credits: [
      {
        text: "WIKITONGUES: Stephan and Simon speaking Frisian (Wikitongues, recorded by Guillem Belmar)",
        url: "https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Stephan_and_Simon_speaking_Frisian.webm",
        licence: "CC BY-SA 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
    ],
    afterSound: true,
    beforeSound: false,
  },
  {
    slug: "sage-launch",
    status: "ready",
    title: "A product launch film drawn in code from the app's own screens",
    style: "product-launch-film",
    aspect: "16:9",
    durationSec: 48.3,
    prompt: "/launch-film Design a ~48-second launch film for Sage. Treat it as motion design, not an edit: one canvas program that redraws Sage and choreographs it. Read bay://guide/motion-design first and build from its kit. Take your time: plan it, build it, look at it, and rebuild it. Three or more passes is expected.\n\nWHAT SAGE IS: an agentic AI assistant that lives at the top of your Mac and actually does things. Tagline: \"The Agentic AI Assistant for your Mac\". Short line: \"Your Mac, on command.\"\n\nHARD RULES:\n- The panel at the top of the screen is the **Halo**. Never call it a notch, and never write \"perry\" or \"notchview\" anywhere.\n- Claim only what Sage does and what the reference footage shows: no invented numbers, customers, prices, dates or URLs.\n- ChatGPT: say \"your ChatGPT subscription\". Never \"official\", \"partnered\" or \"powered by OpenAI\", and no OpenAI logos.\n- For the approval, draw Sage's approval card exactly as 05b shows it (with its \"from your server\" line) and click Allow once. Never doctor it.\n\nREFERENCE (in the pool; draw from these, don't lay them over the film). These are the latest build, light and dark:\n- **01-halo-expand-light / -dark**: collapsed, the Halo is a pure-black capsule at the top centre. It morphs down into a Liquid-Glass panel, which follows light and dark. Home shows Now Playing (\"Afterglow\", art, scrubber, prev/play/next) and a status list: Keep Awake toggle; Up next · Standup in 8 min with Join; CPU and Memory bars; Battery.\n- **02-halo-tabs**: the tab bar with Tray (files), Clipboard (cards) and Cloud (today's to-dos, one ticked; notes).\n- **03-halo-moments-light / -dark**: the collapsed Halo's live moments. Plugged in: a bolt plus a battery filling to 64%. A song: art plus waveform bars, and \"Title - Artist\" on track change (\"Low Tide — Harbor Lights\").\n- **04-halo-alert**: a live activity slides out: \"Send the Q3 roadmap · Due at 5:00 PM\".\n- **05a-ask-model-chip**: the Ask field's model chip. Pick a model in one step; it switches from Ollama to \"ChatGPT · gpt-5.1\".\n- **05b-ask-agent-light / -dark**: \"check my battery and set volume to 30\". Steps stream: Thinking → Running tool get_battery → Tool Result \"82%, on battery, 5h 12m left\" → an approval card, drawn exactly as Sage renders it (Set Volume, \"from your server\", Allow once / This session / Always / Deny) → Allow once → Running tool set_volume → Complete \"Battery is at 82%… Volume is now 30%\".\n- **06-settings-model**: macOS-style Settings with search and coloured icons. Model lists live models, and provider \"ChatGPT (subscription)\" has a \"Sign in with ChatGPT\" button. Don't show the footer under ChatGPT Subscription.\n- **07-settings-cloud-about**: Cloud (\"Sign in to ChatGPT on your server\", what syncs); About with Resource usage.\n- **08-settings-permissions**: \"Grant everything\" turns every row to Allowed.\n- **00-logo-card.png, wordmark.png**: the NEW Sage mark (a rounded dark square with a white pill \"halo\" and a blue spark) and the wordmark. Use these on the end card.\n- **Sound**: music-bed-110bpm.wav (110 BPM, 4/4, 56 s), sfx-click.wav, sfx-whoosh.wav and sfx-bell.wav. All original.\n- **Font**: Inter.woff2.\n- **Everything drawn must match these real screens**: layout, labels, states and values. No invented features, capabilities, numbers, integrations or UI, and no speed claims. No GitHub anywhere, and no URL or domain.\n\nframe_grid those takes until you can redraw the Halo accurately: proportions, radii, glass, type sizes and the real labels.\n\nLOOK: white and premium, like an Apple product film.\n- Canvas #F5F5F7 and ink #1D1D1F; one accent, system blue #007AFF.\n- Inter for statements (600, tracking about −0.035em), a serif italic for one human line, and mono for tiny labels if you use chrome.\n- The glass is frosted white with a hairline and a soft shadow. The collapsed Halo is pure black.\n\nTHE IDEA TO BUILD AROUND: **the Halo is the protagonist.**\n- It is born as a dot at the top centre in the first second, and becomes the black capsule.\n- Every scene is the Halo becoming something: the glass panel, a tab, an Ask field, a step list, an alert, a settings row.\n- It ends as the capsule shrinking back to a dot that becomes the end card.\n- No fades. Morph the Halo from state to state, and give every change an on-screen cause: a cursor press flips a toggle; Approve makes the volume slider move to 30 and the battery count to 82%; \"Grant everything\" cascades each row to Allowed.\n- At least one transition must carry meaning.\n\nSHAPE (a starting point; improve on it):\n1. A hook in bar 0: the dot → the capsule, with \"Your Mac.\" then \"On command.\" (accent on \"command\").\n2. Meet the Halo: it morphs into the glass panel; Home comes alive (the Now Playing scrubber moving, CPU and Memory jittering); the cursor toggles Keep Awake.\n3. \"Everything, one hover away.\": the tabs, with Tray / Clipboard / Cloud whipping between them and a to-do ticked.\n4. \"Ask. It acts. You approve.\": the model chip picked, typing, the steps springing in, the approval card, Allow once, and the results counting in.\n5. \"It keeps you on time.\": it collapses, and the alert slides out.\n6. \"Runs on your ChatGPT subscription.\", then \"Grant once. Connect everything.\", told with the permissions cascade.\n7. A fast montage, one beat each, of what Sage showed.\n8. End: the capsule → a dot → the new Sage mark, the wordmark, \"Your Mac, on command.\", then \"Download for Mac\" (no URL). Hold it at least 2 bars.\n\nTIMING: detect_beats on the music; cut on bar lines, about 22 bars. Place each sfx on the timeline at the frame your code says the press, pop or landing happens, under the music. Fade the music over the last bar.\n\nWhen it's right, export with streaming loudness to ~/Movies/bay-rnd/sage/after.mp4. Then describe the film beat by beat and list what each of your review passes changed.",
    did: [
      "Read bay://guide/motion-design and frame_grid every recording of Sage until it could redraw the Halo, Ask and Settings",
      "detect_beats on the music: 110 BPM, 22 bars, cuts on bar lines",
      "write_composition: one canvas program, redrawn every frame, with the Halo as the protagonist (a dot, the capsule, the panel, tabs, Ask, settings rows, and back to a dot for the end card)",
      "Every change has an on-screen cause: the cursor toggles Keep Awake, the chip menu picks gpt-5.1, and Allow once moves the volume to 30 as Complete counts in",
      "preview_frame and frame_grid across three review passes (tabs overlapping, alpha fades replaced by morphs, the chip-to-Provider flight added)",
      "32 sound effects placed at the frames the code names, then export_timeline, mastered to −14 LUFS",
      "A second message said everything was drawn too small: the UI now fills 55–65% of the frame with the camera pushing in on each action, and the type moved to the brief's scale",
    ],
    credits: [],
    afterSound: true,
    retouched:
      "Transcoded to H.264 with faststart for the page; the picture and sound are the agent's export.",
  },
  {
    slug: "luxury-minimal",
    status: "ready",
    title: "Four stock watch clips cut into a minimal brand film",
    style: "luxury-minimal",
    aspect: "16:9",
    durationSec: 20,
    prompt: "Cut a luxury, minimal film of about 20 seconds from these four watch clips, in the luxury/minimal style. There's no music, so let the picture carry it. Keep any brand names or logos out of frame. When it's done and checked, export it to ~/Movies/bay-rnd/luxury/after.mp4.",
    did: [
      "read_style luxury-minimal, with the rough-cut skill loaded",
      "frame_grid over every clip to find engraved or printed brand names",
      "Dropped the caseback clip: the maker's name is on the rotor in every frame",
      "place_asset for the other three, 6.7 s each",
      "edit_item to crop the two vertical clips to 16:9 clear of the dial branding",
      "edit_item for a quiet grade with fine grain and a 4% push-in on every shot",
      "add_transition cross-dissolve between the shots",
      "frame_grid and preview_frame at every junction",
      "export_timeline",
    ],
    credits: [
      { text: "Mixkit 44070: \"Close-up view of an elegant watch\"", url: "https://assets.mixkit.co/videos/44070/44070-1080.mp4", licence: "Mixkit Stock Video Free License", licenceUrl: "https://mixkit.co/license/#videoFree" },
      { text: "Mixkit 3673: \"Machinery of a very close watch\"", url: "https://assets.mixkit.co/videos/3673/3673-1080.mp4", licence: "Mixkit Stock Video Free License", licenceUrl: "https://mixkit.co/license/#videoFree" },
      { text: "Mixkit 3672: \"Hands on an automatic watch\"", url: "https://assets.mixkit.co/videos/3672/3672-1080.mp4", licence: "Mixkit Stock Video Free License", licenceUrl: "https://mixkit.co/license/#videoFree" },
    ],
  },
];

/**
 * What is missing from an entry marked ready, one sentence per gap. The page
 * throws on any, so `pnpm build` fails rather than publishing a half-filled
 * figure. The media files are checked by the page, which can read the disk.
 */
export function readyProblems(c: Comparison): string[] {
  const out: string[] = [];
  if (!c.prompt.trim() || c.prompt === PENDING) out.push("prompt is still the pending text");
  if (c.did.length === 0) out.push("did lists no steps");
  if (!(c.durationSec > 0)) out.push("durationSec is not a positive number");
  for (const credit of c.credits)
    if (!credit.text || !credit.url || !credit.licence) out.push(`a credit is missing text, url or licence (${credit.text || "untitled"})`);
  return out;
}

/** The entries the page shows. */
export const readyComparisons = (): Comparison[] => comparisons.filter((c) => c.status === "ready");

/** The media for an entry, by the folder convention above. */
export function comparisonPair(c: Comparison): Pair {
  const side = (name: "before" | "after", aspect: Aspect) => ({
    av1: c.av1 === false ? undefined : `/compare/${c.slug}/${name}.av1.mp4`,
    h264: `/compare/${c.slug}/${name}.h264.mp4`,
    poster: {
      avif: `/compare/${c.slug}/${name}-poster.avif`,
      webp: `/compare/${c.slug}/${name}-poster.webp`,
    },
    aspect,
  });
  return { before: side("before", c.beforeAspect ?? c.aspect), after: side("after", c.aspect) };
}

/** Splits a `did` line into its tool name (when it starts with one) and the rest. */
export function splitStep(line: string): { tool?: string; rest: string } {
  const m = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+)\b(.*)$/.exec(line);
  return m ? { tool: m[1], rest: m[2] ?? "" } : { rest: line };
}
