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
 * - `layout`: `wipe` (one frame, a line you drag) needs both sides in one
 *   aspect; `split` (side by side) is for an edit that changes the framing.
 * - `durationSec`: the length of both videos. They must be one length and cut
 *   on the same frames, because the page plays them on one clock.
 * - `prompt`: the exact message given to bay's agent, verbatim, typos and all.
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
  layout: "wipe" | "split";
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
    status: "pending",
    title: "A talking head cut into a vertical short",
    style: "retention-talking-head",
    aspect: "9:16",
    beforeAspect: "16:9",
    layout: "split",
    durationSec: 0,
    prompt: PENDING,
    did: [],
    credits: [],
  },
  {
    slug: "news-explainer",
    status: "pending",
    title: "A news explainer with lower-thirds",
    style: "news-lower-thirds",
    aspect: "16:9",
    layout: "wipe",
    durationSec: 0,
    prompt: PENDING,
    did: [],
    credits: [],
  },
  {
    slug: "kinetic-type",
    status: "pending",
    title: "Kinetic type set to a track",
    style: "kinetic-typography",
    aspect: "9:16",
    layout: "wipe",
    durationSec: 0,
    prompt: PENDING,
    did: [],
    credits: [],
  },
  {
    slug: "luxury-minimal",
    status: "pending",
    title: "A slow, minimal brand film",
    style: "luxury-minimal",
    aspect: "16:9",
    layout: "wipe",
    durationSec: 0,
    prompt: PENDING,
    did: [],
    credits: [],
  },
  {
    slug: "launch-film",
    status: "pending",
    title: "A product launch film",
    style: "product-launch-film",
    aspect: "16:9",
    layout: "wipe",
    durationSec: 0,
    prompt: PENDING,
    did: [],
    credits: [],
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
  if (c.layout === "wipe" && (c.beforeAspect ?? c.aspect) !== c.aspect)
    out.push("a wipe needs both sides in one aspect; use layout: 'split'");
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
