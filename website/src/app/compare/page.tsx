import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { BeforeAfter } from "@/components/app/BeforeAfter";
import { Block, PageHeader, Prompt, Rule, StepList, TextLink, Wrap } from "@/components/layout";
import {
  STYLE_TITLES,
  comparisonPair,
  readyComparisons,
  readyProblems,
  splitStep,
  type Comparison,
} from "@/lib/comparisons";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Compare",
  description: `Raw footage beside the edit ${product.name}'s agent made of it, with the prompt it was given and the tools it ran.`,
};

/**
 * A ready entry must be whole before it is published: every field filled from
 * the run, and every media file in `public/compare/<slug>/`. This runs at build
 * time, so a half-filled entry fails `pnpm build` instead of shipping.
 */
function checked(entries: Comparison[]): Comparison[] {
  for (const c of entries) {
    const problems = readyProblems(c);
    const pair = comparisonPair(c);
    for (const side of [pair.before, pair.after]) {
      for (const file of [side.av1, side.h264, side.poster.avif, side.poster.webp]) {
        if (file && !existsSync(join(process.cwd(), "public", file))) problems.push(`missing public${file}`);
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `/compare: "${c.slug}" is marked ready but ${problems.join("; ")}. Fill it from the run, run scripts/encode-compare.sh, or set status: "pending".`,
      );
    }
  }
  return entries;
}

const LINK = "underline underline-offset-2 hover:text-ink";

function Credits({ entry }: { entry: Comparison }) {
  if (entry.credits.length === 0) return null;
  return (
    <p className="mt-6 max-w-[80ch] text-xs leading-relaxed text-muted">
      Footage and sound:{" "}
      {entry.credits.map((credit, i) => (
        <span key={credit.url}>
          {i > 0 ? "; " : null}
          <a href={credit.url} className={LINK}>
            {credit.text}
          </a>
          , under the{" "}
          {credit.licenceUrl ? (
            <a href={credit.licenceUrl} className={LINK}>
              {credit.licence}
            </a>
          ) : (
            credit.licence
          )}
        </span>
      ))}
      .
    </p>
  );
}

function Figure({ entry }: { entry: Comparison }) {
  const sides =
    entry.layout === "wipe"
      ? "Left of the line, the footage as the agent was given it. Right of it, the file the agent exported."
      : "Left (above, on a phone), the footage as the agent was given it. Right, the file the agent exported.";
  return (
    <section aria-labelledby={`${entry.slug}-title`}>
      <Reveal>
        <h2 id={`${entry.slug}-title`} className="text-section font-semibold text-ink">
          {entry.title}
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          Style: {STYLE_TITLES[entry.style]}. {Math.round(entry.durationSec)} seconds.
        </p>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="mt-8">
          <BeforeAfter
            pair={comparisonPair(entry)}
            layout={entry.layout}
            sound={entry.afterSound ?? false}
            label={entry.title}
            caption={sides}
            notes={
              <>
                <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
                  <div>
                    <p className="text-xs text-muted">What ran, in order</p>
                    <div className="mt-2">
                      <StepList steps={entry.did.map(splitStep)} />
                    </div>
                  </div>
                  <Prompt>{entry.prompt}</Prompt>
                </div>
                <p className="mt-6 max-w-[80ch] text-sm text-ink-soft">
                  {entry.retouched ?? "Nothing was changed by hand after the agent finished."}
                </p>
                <Credits entry={entry} />
              </>
            }
          />
        </div>
      </Reveal>
    </section>
  );
}

export default function ComparePage() {
  const entries = checked(readyComparisons());

  return (
    <main className="flex-1 pb-28">
      <PageHeader
        eyebrow="Compare"
        title="What went in, and what the agent made of it."
        lead={`Each figure is one run of ${product.name}'s agent: the footage it was given on one side, the file it exported on the other, and under them the message it was given, word for word, and the tools it called.`}
      />
      <Wrap>
        {entries.length === 0 ? (
          <div className="mt-16">
            <Block title="Nothing to compare yet">
              The first runs are still being exported. A figure goes up here once its prompt, its
              tool log and its footage credits have been checked against the run. Until then, the{" "}
              <TextLink href="/">home page</TextLink> has one: four clips and the edit made of them.
            </Block>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={entry.slug} className="mt-16">
              {i > 0 ? <Rule className="mb-16" /> : null}
              <Figure entry={entry} />
            </div>
          ))
        )}

        <div className="mt-24">
          <Rule className="mb-14" />
          <Block title="What it will not do">
            These are runs someone picked, and the page does not say how many came before each
            one. Each prompt is printed as it was typed. Every edit was made by the agent inside{" "}
            {product.name}, with the tools listed under it, and exported by {product.name}; nobody
            changed a frame afterwards unless the figure says so. The agent did not choose the
            footage. A person did, and the credits say where it came from.
          </Block>
        </div>

        {entries.some((e) => e.credits.length > 0) ? (
          <div className="mt-24">
            <Block title="Credits">
              Every piece of footage and sound on this page belongs to the people named here, and
              is used under the licence named beside it. All of it is served from this site;
              nothing is embedded from anywhere else.
              <ul className="mt-6 space-y-4">
                {entries
                  .filter((e) => e.credits.length > 0)
                  .map((e) => (
                    <li key={e.slug}>
                      <p className="text-sm font-medium text-ink">{e.title}</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {e.credits.map((credit) => (
                          <li key={credit.url}>
                            <a href={credit.url} className="text-accent-ink underline underline-offset-4 hover:text-ink">
                              {credit.text}
                            </a>
                            , {credit.licence}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </Block>
          </div>
        ) : null}
      </Wrap>
    </main>
  );
}
