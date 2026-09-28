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
 *   `kinetic-typography`, `luxury-minimal`, `product-launch-film`, `ugc-ad`).
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
  | "ugc-ad";

/** The built-in styles' titles, as `../src/shared/styles/*.ts` spells them. */
export const STYLE_TITLES: Record<StyleId, string> = {
  "retention-talking-head": "Retention talking-head short",
  "news-lower-thirds": "News package with lower-thirds",
  "kinetic-typography": "Kinetic typography / lyric video",
  "luxury-minimal": "Luxury / minimal brand film",
  "product-launch-film": "Product launch film",
  "ugc-ad": "UGC ad / testimonial",
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
    slug: "retention-short",
    status: "ready",
    title: "A six-minute selfie cut into a vertical short",
    style: "retention-talking-head",
    aspect: "9:16",
    durationSec: 46.5,
    prompt: "Turn this into a vertical short of about 45 seconds in the retention talking-head style. James speaks English with a Yorkshire accent, so transcribe it as English. Pick his most interesting 45 seconds, open on the strongest line, and keep his words exactly as he says them. When it's done and checked, export it to ~/Movies/bay-rnd/retention/after.mp4.",
    did: [
      "read_style retention-talking-head, with the short-form and highlights skills loaded",
      "set_canvas to vertical 1080×1920",
      "find_highlights and transcribe (English) to choose his strongest passage",
      "remove_range to cut the dead air and everything outside the passage",
      "Cold open moved to the front: \"I'm trying to do my bit to keep dialect alive\"",
      "split_at into 13 shots of 2–4.5 s",
      "edit_item to alternate a 12% punch-in on every other shot",
      "write_brf for word-by-word Punch subtitles, the spoken word in yellow",
      "write_brf for the hook title over the first two seconds",
      "export_timeline, mastered to −14 LUFS",
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
    slug: "news-explainer",
    status: "ready",
    title: "An interview turned into an explainer, with graphics timed to her words",
    style: "news-lower-thirds",
    aspect: "16:9",
    durationSec: 44.9,
    prompt: "Make a news-explainer cut of about 45 seconds from Dr. Kelsey Young's Artemis II interview, in the news lower-thirds style. Use her strongest, most self-contained answer. Put a lower third with her name, and her role only if she states it on camera. Wherever she explains something concrete — the mission, the crew, where they fly, a number or a date — show it on screen with a motion graphic that illustrates it (a simple diagram, a callout, a key-fact card), timed to the words, so a viewer with the sound off still gets the story. Keep her face on screen for most of it; graphics sit beside or over her, not instead of her. The audio is quiet, so bring it up to a normal level. End with a small credit line: \"Video: NASA's Goddard Space Flight Center\". When it's done and checked, export it to ~/Movies/bay-rnd/news/after.mp4.",
    did: [
      "read_style news-lower-thirds, then transcribe to find her strongest answer",
      "remove_range to drop the title and question cards and the dead air, keeping two passages",
      "add_transition, a 10-frame cross-dissolve over the one join",
      "write_brf for the name super; no role line, because she never states it on camera",
      "write_brf for two fact cards: first crewed flight of Orion, and the name Integrity",
      "edit_item keyframes to slide her left, still on screen, making room for a side panel",
      "write_brf for the side panel: a crew card, a five-step mission-path diagram, a lunar-science checklist",
      "write_brf for the credit line",
      "export_timeline, mastered to −14 LUFS",
      "A second message asked for bigger panel type; write_brf rewrote the panel",
      "A third message pointed out the re-export was unmastered; export_timeline again, mastered to −14 LUFS",
    ],
    credits: [
      {
        text: "Kelsey Young SOTs, Artemis II (NASA's Goddard Space Flight Center)",
        url: "https://svs.gsfc.nasa.gov/14934",
        licence: "Public domain (NASA media)",
        licenceUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
      },
    ],
    afterSound: true,
  },
  {
    slug: "kinetic-type",
    status: "ready",
    title: "Eighteen seconds of speech set as kinetic type",
    style: "kinetic-typography",
    aspect: "9:16",
    durationSec: 18.6,
    prompt: "Make a kinetic-typography piece of about 20 seconds from James talking: his voice is the soundtrack, and his words animate on screen exactly as he says them, in the kinetic typography style. Pick one passage that works on its own. Vertical 1080×1920. When it's done and checked, export it to ~/Movies/bay-rnd/kinetic/after.mp4.",
    did: [
      "read_style kinetic-typography, with the motion-graphics skill loaded",
      "find_highlights to choose a passage that stands on its own",
      "set_canvas to vertical 1080×1920",
      "detach_audio to keep his voice as the soundtrack and drop the picture",
      "write_brf: every word timed to the transcript, key words larger and in red, a progress bar",
      "frame_grid and preview_frame to check each word lands as it is spoken; fixed a blank stretch from 10 s",
      "Left the college name off screen because the transcript misheard it, rather than guess",
      "export_timeline, then a second export after a follow-up message asked for it unchanged but mastered to −14 LUFS",
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
    beforeSound: true,
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
