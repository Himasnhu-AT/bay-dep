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
    "The same engine that draws the timeline serves it over the Model Context Protocol, with the app open or closed.",
};

const tools = [
  {
    label: "Build",
    title: "Make a project and fill it",
    body: "Create a project at a canvas size and frame rate, import media off the disk, and place text, shapes, images, video and audio on the timeline at the ticks you choose.",
  },
  {
    label: "Move",
    title: "Animate with easing",
    body: "Keyframe the properties of anything placed, with easing, so a title can arrive and leave rather than appear and vanish.",
  },
  {
    label: "Speak",
    title: "Narrate and caption",
    body: "Hand it a script and it is spoken on the machine, then captioned against the words that were actually said rather than the words that were written.",
  },
  {
    label: "Look",
    title: "Snapshot a frame",
    body: "Ask for a still of any moment and get an image back. This is the one that matters: an agent that can see the frame it just built can tell whether it was right.",
  },
  {
    label: "Render",
    title: "Encode the MP4",
    body: "Export the timeline to a file on your disk. The same path the editor uses, on the same machine, with no queue in front of it.",
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
          <Eyebrow>With the app open</Eyebrow>
          <p className="mt-6 mb-7 text-base text-ink-soft">
            Edits land in the window in front of you, and your undo works on
            them. Launching a second time raises the window that is already open
            rather than starting a rival with its own timeline, so there is
            never a question of which document is being edited.
          </p>
        </Reveal>

        <Reveal delay={0.36} className="max-w-[60ch] space-y-2.5">
          <Command>{product.name.toLowerCase()}</Command>
          <Command>
            claude mcp add --transport http {product.name.toLowerCase()}{" "}
            http://127.0.0.1:7333/mcp
          </Command>
        </Reveal>

        <Reveal delay={0.42} className="mt-14 max-w-[60ch]">
          <Eyebrow>With the app closed</Eyebrow>
          <p className="mt-6 mb-7 text-base text-ink-soft">
            Headless, for rendering. No window, no display, the same engine.
          </p>
        </Reveal>

        <Reveal delay={0.46} className="max-w-[60ch]">
          <Command>
            {product.name.toLowerCase()} --mcp --port 7333
          </Command>
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
            The endpoint is bound to your own machine. It is not a hosted API,
            there is no key to obtain, and nothing about your project is sent
            anywhere for an agent to reach it. Which model you point at it is
            your business, including a local one.
          </p>
        </Reveal>
      </Wrap>
    </main>
  );
}
