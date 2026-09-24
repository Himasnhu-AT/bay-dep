import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronRight,
  Clock,
  Loader2,
  ShieldCheck,
  Square,
  Undo2,
} from "lucide-react";
import { CHANGES, STEPS } from "@/lib/sequence";

/**
 * The app's agent panel, from src/renderer/src/editor/AgentPanel.tsx and
 * Composer.tsx: your message on the right in a bubble, the agent's prose under
 * it, one card per tool call with a check once it returns, and at the end of a
 * turn that changed the project, the Changes card with its Revert.
 *
 * The log fills from the top and, once it is full, keeps its newest entry in
 * view the way the panel scrolls: a column pushed to the top by an auto
 * margin while it fits, and aligned to the bottom once it overflows. No script
 * measures anything, so a figure rendered without JavaScript reads the same.
 */
export function AgentPanel({ step }: { step: number }) {
  // The panel shows its newest entries and clips the rest off the top, as it
  // scrolls. Anything more than a panel's worth back could never be seen, so it
  // is not rendered: in the stacked fallback that is six figures' worth of log.
  // The user's message stays while it could still be in view.
  const first = Math.max(0, step + 1 - 16);
  const shown = STEPS.slice(first, step + 1);
  const running = shown[shown.length - 1]?.kind !== "changes";

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-surface-1">
      <div className="flex h-9 shrink-0 items-center border-b border-app-line px-3">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-app-ink-0 uppercase">
          Agent
        </span>
        <span className="ml-auto rounded-[4px] bg-app-surface-2 px-2 py-0.5 text-[11px] text-app-ink-0">
          New
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        <div className="mb-auto flex flex-col gap-2 p-2">
          {shown.map((s, i) => {
            const latest = i === shown.length - 1;
            // The line that just landed is the one to connect to the editor,
            // so everything older steps back a little.
            const dim = latest ? "" : "opacity-75";
            if (s.kind === "user") {
              return (
                <p
                  key={first + i}
                  className={`plate-in max-w-[92%] self-end rounded-lg bg-app-surface-3 px-2.5 py-1.5 text-[12px] leading-relaxed text-app-ink-0 transition-opacity duration-500 ${dim}`}
                >
                  {s.text}
                </p>
              );
            }
            if (s.kind === "say") {
              return (
                <p
                  key={first + i}
                  className={`plate-in text-[12px] leading-relaxed text-app-ink-1 transition-opacity duration-500 ${dim}`}
                >
                  {s.text}
                </p>
              );
            }
            if (s.kind === "changes") {
              return (
                <div
                  key={first + i}
                  className="plate-in rounded-lg border border-app-line bg-app-surface-2 text-[11px]"
                >
                  <div className="flex items-center gap-2 border-b border-app-line px-2 py-1.5">
                    <span className="font-medium text-app-ink-0">{CHANGES.count} changes</span>
                    <span className="ml-auto flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-app-ink-0">
                      <Undo2 aria-hidden className="size-3" />
                      Revert
                    </span>
                  </div>
                  <ul className="flex flex-col gap-0.5 px-2 py-1.5">
                    {CHANGES.lines.map((line) => (
                      <li key={line} className="flex gap-1.5 leading-relaxed">
                        <span aria-hidden className="w-2 shrink-0 font-app-mono text-app-success">
                          +
                        </span>
                        <span className="min-w-0 truncate text-app-ink-1">{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="px-2 pb-1.5 text-[10.5px] text-app-ink-2">Show all {CHANGES.count}</p>
                </div>
              );
            }
            const open = Boolean(s.result);
            return (
              <div
                key={first + i}
                className={`plate-in rounded-[4px] border border-app-line bg-app-surface-2 text-[11px] transition-opacity duration-500 ${dim}`}
              >
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <Check aria-hidden className="size-3 shrink-0 text-app-ink-2" />
                  <span className="font-app-mono text-app-ink-1">{s.text}</span>
                  <ChevronRight
                    aria-hidden
                    className={`ml-auto size-3 shrink-0 text-app-ink-3 ${open ? "rotate-90" : ""}`}
                  />
                </div>
                {open ? (
                  <div className="border-t border-app-line px-2 py-1.5">
                    <p className="font-app-mono text-[10px] leading-relaxed break-words text-app-ink-2">
                      {s.args}
                    </p>
                    <p className="mt-1 font-app-mono text-[10px] leading-relaxed break-words text-app-ink-2">
                      {"{ "}
                      {s.result}
                      {", … }"}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* The composer. While the agent works it says so and offers Stop. */}
      <div className="m-2 mt-0 hidden shrink-0 rounded-lg border border-app-line-strong bg-app-surface-2 @5xl/plate:block">
        <p className="px-3 pt-2.5 pb-6 text-[12px] leading-snug text-app-ink-2">
          Describe what you’d like to create… (@ to pin, / for skills)
        </p>
        <div className="flex items-center gap-2.5 px-3 pb-2 text-app-ink-1">
          <span className="flex items-center gap-1 text-[11px]">
            <Bot aria-hidden className="size-3.5" />
            Agent
          </span>
          <AtSign aria-hidden className="size-3.5" />
          <ShieldCheck aria-hidden className="size-3.5" />
          <Clock aria-hidden className="size-3.5" />
          {running ? (
            <>
              <span className="ml-auto flex items-center gap-1 text-[11px]">
                <Loader2 aria-hidden className="size-3" />
                Working…
              </span>
              <span className="grid size-6 place-items-center rounded-full bg-app-surface-4 text-app-ink-0">
                <Square aria-hidden className="size-2.5 fill-current" />
              </span>
            </>
          ) : (
            <span className="ml-auto grid size-6 place-items-center rounded-full bg-app-surface-3 text-app-ink-3">
              <ArrowUp aria-hidden className="size-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
