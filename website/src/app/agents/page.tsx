import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import {
  Command,
  Eyebrow,
  PageHeader,
  RuledList,
  RuledRow,
  Wrap,
} from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "The timeline you cut on is served over the Model Context Protocol, to Claude Code in a terminal or to the agent built into the editor.",
};

const tools = [
  {
    label: "Read",
    title: "See the project as it stands",
    body: "Tracks, clips, timings in frames, the media pool, and everything about any one clip. Reading needs no permission, so an agent can check before it changes anything.",
  },
  {
    label: "Propose",
    title: "Show you the plan first",
    body: "Inside the editor, every change starts as a plan on a card: what it will do in plain words, and the exact edits. Nothing is written until you approve one option.",
  },
  {
    label: "Edit",
    title: "Cut, trim, layer and style",
    body: "Place media, remove a stretch of time across every track at once, split, move and fade clips, add transitions, set adjustments and type, and drop in title and caption templates sized to your canvas.",
  },
  {
    label: "Look",
    title: "Render a frame and look at it",
    body: "Ask for any moment and get a picture back. This is the one that matters: an agent that can see the frame it just built can tell whether it was right.",
  },
  {
    label: "Render",
    title: "Export the file",
    body: "Encode the timeline to MP4, MOV or WebM, or its audio to WAV or MP3, on your machine, through the same path the editor's own Export button uses.",
  },
];

export default function AgentsPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Agents"
          title={
            <>
              An editor that can be{" "}
              <em className="text-brass italic">told</em> what to do.
            </>
          }
          lead={`Most tools bolt an assistant onto the side of the app and hope the two agree. ${product.name} does not have a second implementation to disagree with: the engine is served directly, so an agent works the same timeline you do.`}
        />

        <Reveal delay={0.3} className="mt-16 max-w-[60ch]">
          <Eyebrow>From Claude Code</Eyebrow>
          <p className="mt-6 mb-7 text-base text-ink-soft">
            Edits land in the window in front of you, and your undo works on
            them. If the app is not running, the first tool call opens it. The
            connection is a local socket only your user account can open; there
            is no port, and nothing on another machine can reach it.
          </p>
        </Reveal>

        <Reveal delay={0.36} className="max-w-[60ch] space-y-2.5">
          <Command>
            claude mcp add {product.name.toLowerCase()} --env
            ELECTRON_RUN_AS_NODE=1 --
            /Applications/{product.name.toLowerCase()}.app/Contents/MacOS/
            {product.name.toLowerCase()}{" "}
            /Applications/{product.name.toLowerCase()}.app/Contents/Resources/app.asar/out/main/mcp/index.js
          </Command>
        </Reveal>

        <Reveal delay={0.42} className="mt-14 max-w-[60ch]">
          <Eyebrow>Inside the editor</Eyebrow>
          <p className="mt-6 mb-7 text-base text-ink-soft">
            The Agent panel runs Claude Code for you, with the editor&apos;s
            tools and nothing else: no shell, no files, no web. It proposes,
            you approve, and it checks the frame before it says it is done.
          </p>
        </Reveal>

        <RuledList>
          {tools.map((t, i) => (
            <RuledRow
              key={t.label}
              delay={0.06 + Math.min(i, 4) * 0.06}
              wide
              aside={
                <span className="text-eyebrow font-medium text-brass-deep uppercase">
                  {t.label}
                </span>
              }
              title={t.title}
            >
              {t.body}
            </RuledRow>
          ))}
        </RuledList>

        <Reveal delay={0.12} className="mt-20 max-w-[60ch]">
          <Eyebrow>What it will not do</Eyebrow>
          <p className="mt-6 text-base text-ink-soft">
            The connection is bound to your own machine. It is not a hosted
            API, there is no key to obtain, and nothing about your project is
            sent anywhere for an agent to reach it. Any MCP client can drive it,
            including one running a local model.
          </p>
        </Reveal>
      </Wrap>
    </main>
  );
}
