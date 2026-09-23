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
    body: "Import media, place it, trim, split, move and fade it, cut a stretch of time out of every track at once, slip, slide and roll, add markers, and export MP4, MOV or WebM, or the audio alone. Sixteen blend modes, image adjustments and type styling.",
  },
  {
    title: "Transitions, picture and sound",
    body: "Dissolves, dips, wipes, pushes, slides and irises across a cut. The sound cross-fades on the same curve as the picture, in the preview and in the exported file, and an automated check compares the two frame by frame.",
  },
  {
    title: "Titles, captions and templates",
    body: "Seven motion templates, a lower third, a title card, subtitles and more, that size themselves to a landscape, portrait or square canvas. Captions from an SRT or WebVTT file, or from timed lines, on their own track in one undo step. A motion graphic can carry its own sound, heard in the preview and in the file.",
  },
  {
    title: "An agent inside the editor",
    body: "Claude Code in a panel, with the editor's tools and nothing else. It proposes a plan, you approve it on a card, and exactly that runs. It renders the frames it changed and looks at them before it reports back.",
  },
  {
    title: "The agent endpoint",
    body: "Every editing operation over the Model Context Protocol, to Claude Code or any other client on this Mac, with a three-tool mode for clients that do not search their tools. Frames come back as images. Any edit can be checked with a dry run first.",
  },
];

const wrong = [
  {
    title: "An approved plan cannot use what it creates",
    body: "Each step of a plan has to name the clips it touches before anything runs, so a plan that splits a clip and then moves the new half has to be approved in two stages. The agent is told this; it is still a limit.",
  },
  {
    title: "The alternative agent runtime is slower per message",
    body: "The in-app agent can run on the Agent SDK instead of the installed Claude Code. It works the same way from the panel, but starts a fresh process for every message, so each reply begins with a few seconds of startup.",
  },
];

const notYet = [
  {
    title: "Notarized downloads",
    body: "Builds can now be signed with a Developer ID. Notarization is wired up but has not been run, so there is no download on this site yet that Gatekeeper will open without a warning.",
  },
  {
    title: "Windows and Linux",
    body: "The packager is configured for both. Neither has been built and used, so neither is something to rely on.",
  },
  {
    title: "Some controls exist only for the agent",
    body: "Renaming an asset and importing captions are available to an agent but have no button in the editor yet.",
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
