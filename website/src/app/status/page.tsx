import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import {
  Eyebrow,
  PageHeader,
  RuledList,
  RuledRow,
  Wrap,
} from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Status",
  description:
    "What works today, what is known to be wrong, and what has not been written yet.",
};

/**
 * The page the site exists to be able to write. If a row here ever describes
 * something that does not run, the whole position collapses, so nothing goes
 * in the built column until it has been used.
 */
const built = [
  {
    title: "The editing loop",
    body: "Import media, place it, trim it, transform it, blend it, play it back, and export an MP4. Seventeen blend modes reach the GPU. Sources are fitted rather than stretched to the canvas.",
  },
  {
    title: "The agent endpoint",
    body: "Twenty-one tools over MCP, headless or against the open window, including frame snapshots and render.",
  },
  {
    title: "Narration and captions",
    body: "Local text to speech, with captions cut against the spoken words.",
  },
  {
    title: "A decode path that does not freeze the window",
    body: "Decoding runs off the render path on a background worker under a global memory budget. A ten-minute clip appears in under two seconds instead of locking the editor for half a minute.",
  },
  {
    title: "A bundle you can hand to someone",
    body: "A universal Mac app and a .dmg, built locally in about a minute. Unsigned by default, which means the OS warns once on first run.",
  },
];

const wrong = [
  {
    title: "Long clips play as a low-quality proxy",
    body: "A ten-minute clip no longer freezes the editor, but it plays back at a few frames a second at reduced resolution. Quality is being traded away quietly, which is the wrong trade to make without saying so. Windowed decode around the playhead is the fix.",
  },
  {
    title: "The media panel shows demo tiles",
    body: "Imported media works: it renders, plays and exports. The panel just does not list it, so the tiles you see are not the files you have.",
  },
  {
    title: "Anamorphic footage renders at the wrong aspect",
    body: "The sample aspect ratio in the source is ignored, so anamorphic material comes out with the wrong shape.",
  },
  {
    title: "Rotation metadata has a sign bug",
    body: "Two ways of recording rotation use opposite conventions and one of them is being read with the wrong sign, so some phone footage arrives upside down.",
  },
];

const notYet = [
  {
    title: "Most of the timeline craft",
    body: "Slip, slide and roll trims, the transport, the audio mixer and much of the inspector are planned and not written. What exists is enough to build a cut, not enough to finish one comfortably.",
  },
  {
    title: "Windows",
    body: "The build is wired up and runs on a CI runner, because a Windows build genuinely cannot be produced on a Mac. It is not a target anyone should rely on yet.",
  },
  {
    title: "Signing and notarization",
    body: "The tooling accepts a signing identity, but the builds handed out are unsigned. There is no notarized download on this site, and there will not be one until it is real.",
  },
];

function Section({
  eyebrow,
  lead,
  rows,
  state,
}: {
  eyebrow: string;
  lead: string;
  rows: { title: string; body: string }[];
  state: string;
}) {
  return (
    <section className="mt-20 first:mt-16">
      <Reveal className="max-w-[60ch]">
        <Eyebrow>{eyebrow}</Eyebrow>
        <p className="mt-6 text-base text-ink-soft">{lead}</p>
      </Reveal>
      <RuledList>
        {rows.map((r, i) => (
          <RuledRow
            key={r.title}
            delay={0.06 + Math.min(i, 4) * 0.05}
            wide
            aside={
              <span className="text-eyebrow font-medium text-brass-deep uppercase">
                {state}
              </span>
            }
            title={r.title}
          >
            {r.body}
          </RuledRow>
        ))}
      </RuledList>
    </section>
  );
}

export default function StatusPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Status"
          title={
            <>
              What actually <em className="text-brass italic">runs</em>.
            </>
          }
          lead={`${product.name} is ${product.status.toLowerCase()}. Rather than describe it as finished and let you find out otherwise, here is the split: the parts that work, the parts that are known to be wrong, and the parts that have not been written.`}
        />

        <Section
          eyebrow="Works today"
          lead="Used, and covered by tests that run on every change."
          rows={built}
          state="Built"
        />

        <Section
          eyebrow="Known to be wrong"
          lead="Found, reproduced, and not yet fixed. Listing them here is cheaper than you discovering them."
          rows={wrong}
          state="Open"
        />

        <Section
          eyebrow="Not written yet"
          lead="Planned and sized, with nothing behind it in the app today."
          rows={notYet}
          state="Planned"
        />

        <Reveal delay={0.1} className="mt-20 max-w-[60ch]">
          <Eyebrow>No download</Eyebrow>
          <p className="mt-6 text-base text-ink-soft">
            There is no build on this site, because there is not one worth
            handing to a stranger. When there is, it will be a notarized disk
            image served from here. Not a store listing, not a waiting list,
            and not a button that says coming soon.
          </p>
        </Reveal>
      </Wrap>
    </main>
  );
}
