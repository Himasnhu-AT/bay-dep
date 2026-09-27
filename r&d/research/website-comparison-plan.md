# Website before/after comparison page: plan

Researched 2026-09-27 (read-only survey of `website/`). File:line refs are as of `main` at e953244.

## 1. What exists

**Stack.** Next.js 16.3.5 app router, React 19.3, Tailwind v4, pnpm (`website/package.json`). Every route
is prerendered static (`website/CLAUDE.md:5-7`).

**Routes.**
- `/`, `/agents`, `/status`, `/waitlist`, `/desktop/sign-in`, `/admin` (`website/CLAUDE.md:78-79`).
- Nav links sit in `src/components/SiteNav.tsx:16-18`; footer links in `src/components/SiteFooter.tsx:24-33`.

**Design and copy.**
- `src/app/layout.tsx` sets up Inter through `next/font` (self-hosted).
- Tokens live in `@theme` in `src/app/globals.css`, documented in `website/DESIGN.md`: Tokens :43, Before
  and after :222, Components :250, Motion :333, Adding a page :510.
- Page primitives are in `src/components/layout.tsx`: Wrap, Headline, PageHeader, Columns, Block, MarkedGrid.
- Copy rules are in `website/VOICE.md`: one-word lowercase slugs, sentence-case headings, no em dashes.

**A comparison already exists: `src/components/app/BeforeAfter.tsx`**, a drag-wipe slider used once at
`src/app/page.tsx:131`.
- It lazy-loads within 600 px of the viewport (:59-75) and plays muted only while visible (:77-94).
- It syncs the two videos with `requestVideoFrameCallback` (:97-117) and respects reduced motion (:62-63).
- It has a keyboard range input (:213-224) and a "Hear the edit" unmute (:258-266).
- It is **hard-coded to one pair**: sources at :25-28, posters at :33-35, the "Fig. 2" caption at :244-248.

**Media.**
- Self-hosted in `website/public/`. `public/compare/{before,after}.{av1,h264}.mp4` are 0.63–1.02 MB each:
  960×540, 18.9 s, AV1 first with H.264 as fallback.
- Posters are `-poster.avif` and `.webp`, about 30 KB each.
- All of it is plain git (no LFS), and credits are in `website/CREDITS.md`.

## 2. How it deploys

**Vercel Git integration.** `vercel[bot]` deploys `Himasnhu-AT/vii`:
- A merge to `main` goes to Production at `bay.everholt.com` (`src/lib/product.ts:36`); the latest was
  e953244, the PR #21 merge.
- Every pushed branch gets a Preview.

**No config in the repo.**
- There is no `vercel.json`, no `.vercel`, no `.github/workflows`, and `next.config.ts` is empty.
- The root directory is probably set to `website` in the Vercel dashboard. That is not visible from here.

**Firebase is not hosting.** `firebase/firebase.json` covers Firestore and its emulator only.

**To ship.**
- In `website/`, run `pnpm build && pnpm lint` (`website/CLAUDE.md:114-120`), then push a branch (for a
  Preview) and merge a PR into `main` (Production).
- No Vercel token is needed. The agent cannot see the Vercel dashboard or logs, and merging to `main`
  needs the owner's permission.

## 3. Constraints for 6–10 videos

- **Git.** GitHub blocks files over 100 MB and warns over 50 MB, and history is forever. Don't add LFS:
  there is no `.gitattributes`, and Vercel only fetches LFS when the dashboard setting is on. Keep files small.
- **Vercel bandwidth.** Hobby is about 100 GB/month. A 60 s 1080p video at 10–25 MB per view adds up
  quickly.
- **Headers.** None are set today. If a CSP is ever added it needs `media-src 'self'`.
- **Policy** (`website/CLAUDE.md`):
  - No third-party requests (:15-20): no YouTube, Vimeo or Mux.
  - Nothing may describe behaviour the app doesn't have (:60-65), so every caption and prompt must come
    from a real bay run. Keep the `.bay` and the tool log.
  - Every page needs a "What it will not do" section (:105-106).
  - New layout shapes go into `layout.tsx` and `DESIGN.md` in the same commit (:109-112).
  - Footage licences go in `CREDITS.md`.
- **Encoding convention.**
  - AV1 plus H.264 `.mp4` with `+faststart`, no audio on "before" clips, and 960×540 or 1280×720, with
    AVIF and WebP posters.
  - Targets for 60 s at 720p: about 2–4 MB in AV1 and 3–6 MB in H.264. 1080p costs about 2.5× that.
- **Budget.** 10 pairs × 2 codecs × about 3 MB is roughly 120 MB of git, which is acceptable. At 1080p
  (over 300 MB), use a Vercel Blob store instead, with the owner's approval.

## 4. Recommendation

**Route: `/compare`.** The page is `src/app/compare/page.tsx`, following DESIGN.md:510-517:
- `metadata` titled "Compare"
- `<main className="flex-1 pb-28">`, then a `PageHeader`, then a `Wrap`
- a nav or footer link

**Data: `src/lib/comparisons.ts`.** An array of entries with these fields:
- `slug`, `title`, `durationSec`, `aspect`
- `prompt`: the exact prompt used
- `did`: the bay tools that actually ran, such as `detect_beats`, `remove_range`, a grade,
  `add_transition`, and `export_timeline` with its LUFS
- `credits`

Media goes in `/compare/<slug>/{before,after}.{av1,h264}.mp4` plus `-poster.{avif,webp}`.

**Component: make `BeforeAfter` generic.**
- Take `sources`, `posters`, `aspect` and a `caption` node as props. The home page keeps its current pair.
- Keep the wipe as the main view, and add `layout="split"` for clips whose framing changes (reframes,
  vertical).
- Each figure lazy-loads and plays or pauses on its own. `<figcaption>` carries: title, which side is
  which, what bay did, the prompt (in a Command/blockquote style), and credits.
- Labels stay in the caption, not on top of the picture (DESIGN.md:245). Use `preload="none"`, keep sound
  off until the visitor asks, and don't autoplay until the figure is near the viewport.

**Page order.** Intro paragraph, then the figures separated by `Rule`s, then "What it will not do" (these
are hand-picked runs and the prompts are verbatim), then credits.

## 5. Deploy steps

1. Encode with the bundled ffmpeg at 1280×720:
   - AV1: `-c:v libsvtav1 -crf 38 -movflags +faststart`
   - H.264: `-c:v libx264 -crf 24 -profile:v high -movflags +faststart`
   - Posters from frame 0.

   Note: bay's own ffmpeg has **no libx264** (see root CLAUDE.md), so use a system/Homebrew ffmpeg for
   H.264, or `h264_videotoolbox`.
2. Put the files in `website/public/compare/<slug>/` and keep each under about 8 MB.
3. Add credits to `CREDITS.md` and document the new component options in `DESIGN.md`.
4. In `website/`, run `pnpm build && pnpm lint`. Then check `/compare` in a browser: videos should only
   request on scroll, and there should be zero third-party requests.
5. Push a branch and check the Vercel Preview.
6. Open a PR into `main` and merge it. Vercel deploys Production to bay.everholt.com.
