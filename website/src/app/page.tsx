import type { CSSProperties } from "react";
import { DepthFallback } from "@/components/DepthFallback";
import { Reveal } from "@/components/Reveal";
import { ScrollSequence } from "@/components/app/ScrollSequence";
import {
  ActionLink,
  Eyebrow,
  PullQuote,
  RuledList,
  RuledRow,
  Wrap,
} from "@/components/layout";
import { PROMPT } from "@/lib/sequence";
import { product } from "@/lib/product";

/**
 * THESIS: the page does not describe the mechanism, it runs it. A printed page
 * with the editor tipped into it as a plate, refusing the feature-grid landing
 * this category ships.
 *
 * OWN-WORLD: paper (#f5f1e8), ink, one brass accent, rules where a book rules.
 * Set into it, one dark plate carrying the app's own theme value for value, in
 * the system UI face. Two worlds, one seam, nothing in between.
 *
 * STORY: an agent edits the document you are looking at, through the same
 * commands your clicks produce. The visitor watches a real reel get built, then
 * reads what is honestly missing.
 *
 * FIRST VIEWPORT: eyebrow, display headline, one lead, brass rule; the plate's
 * top edge already entering below it.
 *
 * FORM: pinned scroll-scrubbed plate, six beats. No seed roll: the brief pins
 * both form and world, and this extends an established surface rather than
 * replacing it. See DESIGN.md, "The plate".
 */

/**
 * What the plate does not already demonstrate. A row that restates the sequence
 * in different words is length, not substance, so the beat about an agent's
 * edits landing in your window is not repeated here.
 */
const features = [
  {
    label: "I",
    title: "One timeline, two ways in",
    body: "The timeline you drag clips around on is the one an agent edits. Its changes go through the same code as yours and land on the same undo stack, one step per edit, so there is never a second copy of the project to drift apart from what you see.",
  },
  {
    label: "II",
    title: "Every change comes with a diff",
    body: "Inside the editor, the agent makes the edit and shows you what it changed, in plain words, with a Revert button that puts the project back in one click. Rather see a plan first? Turn on Ask before editing: then nothing is written until you approve one option, exactly that runs, once, and anything else is refused with the reason.",
  },
  {
    label: "III",
    title: "It looks at its own work",
    body: "Clip positions do not say whether a caption covers a face. The agent renders the frame it changed and looks at it before telling you it is done, and says so when a picture is incomplete rather than judging an edit from it.",
  },
  {
    label: "IV",
    title: "Your work stays on the Mac",
    body: "Projects, media and renders stay on your disk. The editor loads no remote fonts, images or scripts and sends no telemetry or analytics. It does go online for a few things you can name: the agent you chose to start talks to its model, a speech model downloads when you ask for one, and the app checks with Google’s sign-in service that your access still stands. Offline it keeps working, and asks you to sign in again only after 14 days without a successful check.",
  },
];

/** How far a hero line rises past the page over the first screen, and how faint it gets. */
const peel = (depth: number, fade: number) =>
  ({ "--depth": depth, "--fade": fade }) as CSSProperties;

export default function Home() {
  return (
    <main className="flex-1">
      <header className="pt-20 pb-16 sm:pt-24">
        <Wrap>
          {/* Depth: each line of the hero peels away a little faster than the
              one under it, so they separate as they leave. See DESIGN.md. */}
          <div data-depth="peel" style={peel(0.16, 0.2)}>
            <Reveal delay={0.05}>
              <div className="mb-[30px]">
                <Eyebrow>
                  {product.kind} · {product.status}
                </Eyebrow>
              </div>
            </Reveal>
          </div>

          <div data-depth="peel" style={peel(0.1, 0.35)}>
            <Reveal delay={0.14} variant="settle">
              <h1 className="max-w-[17ch] font-serif text-display font-light">
                A video editor you can{" "}
                <em className="text-brass italic">talk to</em>.
              </h1>
            </Reveal>
          </div>

          <div data-depth="peel" style={peel(0.05, 0.6)}>
            <Reveal delay={0.3}>
              <p className="mt-[30px] max-w-[56ch] text-lead text-ink-soft">
                {product.name} is a video editor for the Mac. You
                cut on the timeline the way you always have. You can also describe
                the change you want and let something else make it, on that same
                timeline, on your own machine.
              </p>
            </Reveal>

            {/* The rule is drawn last, the way you would rule a line under a title. */}
            <Reveal delay={0.62} className="mt-10 w-16">
              <span
                aria-hidden
                data-rule
                className="block h-px w-full bg-brass"
              />
            </Reveal>
          </div>

          <div data-depth="peel" style={peel(0, 0)}>
            <Reveal delay={0.76}>
              <p className="mt-12 flex items-center gap-3 text-eyebrow font-medium text-muted uppercase">
                Keep scrolling to watch it build one
                <span aria-hidden data-nudge className="text-brass-deep">
                  ↓
                </span>
              </p>
            </Reveal>
          </div>
        </Wrap>
      </header>

      {/* What you are about to watch, said plainly before it starts. */}
      <section className="pb-12">
        <Wrap>
          <Reveal>
            <div className="max-w-[62ch] border-l border-brass pl-5">
              <p className="text-eyebrow font-medium text-muted uppercase">
                What you asked for
              </p>
              <p className="mt-2.5 font-serif text-lead font-light text-ink italic">
                &ldquo;{PROMPT}&rdquo;
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-8 max-w-[74ch] text-base text-ink-soft">
              Below is that request being carried out, one step per scroll. On
              the left is the conversation with your agent and the calls it
              makes. On the right is {product.name} itself, with the clips
              landing on the timeline as they are made. Neither side is sped up
              or rearranged, and the reel at the end is one that exists.
            </p>
          </Reveal>
        </Wrap>
      </section>

      <ScrollSequence />

      <section className="pt-24 pb-28">
        <Wrap>
          <RuledList>
            {features.map((f, i) => (
              <RuledRow
                key={f.label}
                delay={0.06 + Math.min(i, 3) * 0.06}
                aside={
                  <span
                    data-depth="drift"
                    className="inline-block font-serif text-[22px] font-light text-brass-deep italic"
                  >
                    {f.label}
                  </span>
                }
                title={f.title}
              >
                {f.body}
              </RuledRow>
            ))}
          </RuledList>

          <Reveal delay={0.12} className="mt-20 max-w-[60ch]">
            <Eyebrow>What it will not do</Eyebrow>
            <p className="mt-6 text-base text-ink-soft">
              There is no server that holds your project. Access is by
              invitation, and you sign in once with your email; that tells the
              app who you are and nothing about what you edit. There is no
              upload step, no render farm, no library of your footage sitting on
              someone else&rsquo;s disk waiting to be trained on. The agent
              endpoint listens on your own machine and nowhere else, and when an
              agent renders a file it writes it to your disk the same way you
              would. This is not a tier we are keeping back. There is no code in{" "}
              {product.name} that could do otherwise.
            </p>
          </Reveal>

          <Reveal delay={0.16} className="mt-14 max-w-[60ch]">
            <Eyebrow>Where it actually is</Eyebrow>
            <p className="mt-6 text-base text-ink-soft">
              {product.name} is {product.status.toLowerCase()}: real, running,
              and not yet ready for a stranger. Long clips still play back as a
              low-quality proxy, the media panel lists demo tiles instead of
              your imports, and most of the timeline craft is unwritten. All of
              it is listed rather than left for you to find.
            </p>
          </Reveal>

          {product.download ? (
            <Reveal delay={0.2}>
              <ActionLink href={product.download} className="mt-16">
                Download for Mac
              </ActionLink>
            </Reveal>
          ) : (
            <Reveal delay={0.2} className="mt-16 max-w-[60ch]">
              <div id="download">
                <Eyebrow>Releasing soon</Eyebrow>
                <p className="mt-6 text-base text-ink-soft">
                  {product.name} is releasing soon, and there is no download
                  yet. Join the waitlist and we&rsquo;ll let you in. If someone
                  you know already uses it, they can refer you from inside the
                  app.
                </p>
                <ActionLink href="/waitlist" className="mt-8">
                  Join the waitlist
                </ActionLink>
              </div>
            </Reveal>
          )}

          <PullQuote delay={0.24}>
            The engine is the product, and the timeline is one way of reaching
            it.
          </PullQuote>
        </Wrap>
      </section>
      <DepthFallback />
    </main>
  );
}
