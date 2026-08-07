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
    title: "One engine, two ways in",
    body: "The timeline you drag clips around on and the engine an agent talks to are the same Rust code. The window is a shell over it, not a second implementation, so the two can never drift apart on what a cut actually means.",
  },
  {
    label: "II",
    title: "It renders with no window open",
    body: "Everything above happened with the app in front of you. It also runs headless, serving the same twenty-one tools over the Model Context Protocol, so a cut can be built and encoded on a machine with no display attached.",
  },
  {
    label: "III",
    title: "It reads the script out loud",
    body: "Hand it a script and it speaks it, then cuts the captions to the words it actually said rather than the words you wrote. The voice is generated on the Mac; nothing is sent away to be spoken.",
  },
  {
    label: "IV",
    title: "Drawn on the GPU, decoded off the render path",
    body: "A wgpu compositor does the blending, effects and masks. Decoding runs on a background worker under a global memory budget, so dropping a ten-minute clip on the timeline does not freeze the editor while it thinks.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <header className="pt-20 pb-16 sm:pt-24">
        <Wrap>
          <Reveal delay={0.05}>
            <div className="mb-[30px]">
              <Eyebrow>
                {product.kind} · {product.status}
              </Eyebrow>
            </div>
          </Reveal>

          <Reveal delay={0.14} variant="settle">
            <h1 className="max-w-[17ch] font-serif text-display font-light">
              A video editor you can{" "}
              <em className="text-brass italic">talk to</em>.
            </h1>
          </Reveal>

          <Reveal delay={0.3}>
            <p className="mt-[30px] max-w-[56ch] text-lead text-ink-soft">
              {product.name} is a video editor for the Mac, written in Rust. You
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

          <Reveal delay={0.76}>
            <p className="mt-12 flex items-center gap-3 text-eyebrow font-medium text-muted uppercase">
              Keep scrolling to watch it build one
              <span aria-hidden data-nudge className="text-brass-deep">
                ↓
              </span>
            </p>
          </Reveal>
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
                  <span className="font-serif text-[22px] font-light text-brass-deep italic">
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
              There is no server that holds your project. No account to make, no
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
            <Reveal delay={0.2}>
              <ActionLink href="/status" className="mt-16">
                See what works today
              </ActionLink>
            </Reveal>
          )}

          <PullQuote delay={0.24}>
            The engine is the product, and the timeline is one way of reaching
            it.
          </PullQuote>
        </Wrap>
      </section>
    </main>
  );
}
