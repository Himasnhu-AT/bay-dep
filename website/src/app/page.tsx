import type { CSSProperties } from "react";
import { DepthFallback } from "@/components/DepthFallback";
import { Reveal } from "@/components/Reveal";
import { BeforeAfter, HOME_PAIR } from "@/components/app/BeforeAfter";
import { ScrollSequence } from "@/components/app/ScrollSequence";
import {
  ActionLink,
  Block,
  Columns,
  Eyebrow,
  Headline,
  MarkedGrid,
  PullQuote,
  TextLink,
  Wrap,
} from "@/components/layout";
import { product } from "@/lib/product";

/**
 * THESIS: the page does not describe the mechanism, it runs it. The app's own
 * dark is the stage the product is shown on; paper is where you read about it.
 *
 * SURFACES: night from the nav through the edit and the before-and-after, a
 * seam through the middle of that figure, paper for the reading, and night
 * again for the close and the footer. One accent, the app's orange, on both.
 *
 * STORY: the result first (a frame of the finished edit), then the request,
 * then the edit being made one call at a time, then what went in beside what
 * came out, then what the edit does not show, then how to get in.
 *
 * FIRST VIEWPORT: status line, headline, one sentence, the action, and the
 * finished frame already rising into view beneath them.
 */

/**
 * What the plate does not already demonstrate. A row that restates the sequence
 * in different words is length, not substance. Each is headed by the thing in
 * the app it is about, rather than a numeral.
 */
const features = [
  {
    mark: "⌘Z",
    title: "One timeline, two ways in",
    body: "The timeline you drag clips around on is the one an agent edits. Its changes go through the same code as yours and land on the same undo stack, one step per edit, so there is never a second copy of the project to drift apart from what you see.",
  },
  {
    mark: "Revert",
    title: "Every change comes with a diff",
    body: "Inside the editor, the agent makes the edit and shows you what it changed, in plain words, with a Revert button that puts the project back in one click. Rather see a plan first? Turn on Ask before editing: then nothing is written until you approve one option, exactly that runs, once, and anything else is refused with the reason.",
  },
  {
    mark: "preview_frame",
    title: "It looks at its own work",
    body: "Clip positions do not say whether a caption covers a face. The agent renders the frame it changed and looks at it before telling you it is done, and says so when a picture is incomplete rather than judging an edit from it.",
  },
  {
    mark: "On disk",
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
      {/* Night: the hero, the request and the edit, on the app's own ground. */}
      <div className="bg-night text-on-night">
        <header className="pt-16 sm:pt-24">
          <Wrap>
            {/* Depth: each line of the hero peels away a little faster than the
                one under it, so they separate as they leave. See DESIGN.md. */}
            <div data-depth="peel" style={peel(0.14, 0.2)}>
              <Reveal delay={0.05}>
                <Eyebrow tone="night">
                  For Macs with Apple silicon. By invitation.
                </Eyebrow>
              </Reveal>
            </div>

            <div data-depth="peel" style={peel(0.1, 0.3)}>
              <Reveal delay={0.12} variant="settle">
                <h1 className="mt-4 max-w-[13ch] text-display font-semibold text-balance text-on-night">
                  A video editor you can talk to.
                </h1>
              </Reveal>
            </div>

            <div data-depth="peel" style={peel(0.06, 0.5)}>
              <Reveal delay={0.26}>
                <p className="mt-6 max-w-[42ch] text-lead text-pretty text-on-night-soft">
                  Cut on the timeline yourself, or describe the change and an
                  agent makes it on that same timeline, on your own Mac.
                </p>
              </Reveal>

              <Reveal delay={0.38}>
                <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
                  {product.download ? (
                    <ActionLink href={product.download}>Download for Mac</ActionLink>
                  ) : (
                    <ActionLink href="/waitlist">Request access</ActionLink>
                  )}
                  <TextLink href="/status" tone="night" arrow>
                    What runs today
                  </TextLink>
                </div>
              </Reveal>
            </div>
          </Wrap>

        </header>

        <ScrollSequence />
      </div>

      {/* The same edit, as a picture you can check. The seam between night and
          paper runs through the middle of this frame. */}
      <section className="overflow-clip bg-night pt-28 pb-24 sm:pt-32">
        <Wrap>
          <Reveal>
            <Headline tone="night" quiet="Drag the line across the frame.">
              What went in, and what came out.
            </Headline>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-10">
              <BeforeAfter
                pair={HOME_PAIR}
                seam
                caption={
                  <>
                    <span className="font-medium text-ink-soft">Fig. 2</span> Left of the line, the four clips as they
                    came from Pexels, cut to the same frames. Right of it, the edit in Fig. 1.
                  </>
                }
              />
            </div>
          </Reveal>
          <p
            id="credits"
            className="relative mt-6 max-w-[80ch] text-xs leading-relaxed text-muted"
          >
            Footage from Pexels, used under the{" "}
            <a href="https://www.pexels.com/license/" className="underline underline-offset-2 hover:text-ink">
              Pexels licence
            </a>
            :{" "}
            <a href="https://www.pexels.com/video/person-walking-on-beach-shore-during-sunrise-6981405/" className="underline underline-offset-2 hover:text-ink">
              Mikhail Nilov
            </a>
            ,{" "}
            <a href="https://www.pexels.com/video/man-walking-on-beach-during-sunrise-10325661/" className="underline underline-offset-2 hover:text-ink">
              Karma Rayshar
            </a>
            ,{" "}
            <a href="https://www.pexels.com/video/waves-crashing-to-the-rocks-2053565/" className="underline underline-offset-2 hover:text-ink">
              Elia Clerici
            </a>{" "}
            and{" "}
            <a href="https://www.pexels.com/video/top-view-of-ocean-waves-crashing-on-beach-shore-5646564/" className="underline underline-offset-2 hover:text-ink">
              Eduardo Cano Photo Co.
            </a>
            {" "}The music and the surf were made for this page.
          </p>
        </Wrap>
      </section>

      {/* Paper: the reading. */}
      <section className="pt-8 pb-28 sm:pt-12 sm:pb-36">
        <Wrap>
          <Reveal>
            <Headline quiet="Four things about how it is built.">
              What the edit above doesn&rsquo;t show.
            </Headline>
          </Reveal>

          <div className="mt-14">
            <MarkedGrid items={features} />
          </div>

          <Columns ruled className="mt-20">
            <Block title="What it will not do">
              There is no server that holds your project. Access is by
              invitation, and you sign in once with Google; that tells the
              app who you are and nothing about what you edit. There is no upload
              step, no render farm, no library of your footage sitting on
              someone else&rsquo;s disk waiting to be trained on. The agent
              endpoint listens on your own machine and nowhere else, and when an
              agent renders a file it writes it to your disk the same way you
              would. This is not a tier we are keeping back. There is no code in{" "}
              {product.name} that could do otherwise.
            </Block>

            <Block title="Where it actually is" delay={0.08}>
              <p>
                {product.name} is {product.status.toLowerCase()}: real, running,
                and not yet ready for a stranger. Long clips still play back as a
                low-quality proxy, the media panel lists demo tiles instead of
                your imports, and most of the timeline craft is unwritten. All of
                it is listed rather than left for you to find.
              </p>
              <TextLink href="/status" arrow className="mt-5">
                What actually runs
              </TextLink>
            </Block>
          </Columns>

          <PullQuote>
            The engine is the product, and the timeline is one way of reaching
            it.
          </PullQuote>
        </Wrap>
      </section>

      {/* Night again: the close, running into the footer. */}
      <section
        id="download"
        className="border-b border-night-line bg-night py-24 text-on-night sm:py-32"
      >
        <Wrap>
          {product.download ? (
            <Reveal>
              <Headline tone="night" quiet="You need access to sign in.">
                Download for Mac.
              </Headline>
              <p className="mt-6 max-w-[52ch] text-lead text-on-night-soft">
                A notarized disk image for Macs with Apple silicon. {product.name}{" "}
                is by invitation: it opens to a sign-in, and works once your
                Google account has access. Request access, or ask someone who
                already uses it to refer you from inside the app.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
                <ActionLink href={product.download}>Download for Mac</ActionLink>
                <TextLink href="/waitlist" tone="night" arrow>
                  Request access
                </TextLink>
              </div>
            </Reveal>
          ) : (
            <Reveal>
              <Headline tone="night" quiet="There is no download yet.">
                Releasing soon.
              </Headline>
              <p className="mt-6 max-w-[52ch] text-lead text-on-night-soft">
                Request access and we&rsquo;ll let you in. If someone you know
                already uses {product.name}, they can refer you from inside the
                app.
              </p>
              <ActionLink href="/waitlist" className="mt-10">
                Request access
              </ActionLink>
            </Reveal>
          )}
        </Wrap>
      </section>
      <DepthFallback />
    </main>
  );
}
