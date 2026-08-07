import { STEPS } from "@/lib/sequence";

/**
 * The other half of the figure: the conversation that drove the build.
 *
 * This is your own client, not part of the editor, which is the whole point of
 * showing them side by side. The log is pinned to the bottom and clips off the
 * top, the way a chat window behaves once it fills, so the newest call is always
 * the one you are looking at.
 */
export function AgentChat({ step }: { step: number }) {
  // Everything that has happened, up to and including the step you are on. One
  // scroll adds one line, so it is always clear which line moved the editor.
  const all = STEPS.slice(0, step + 1).filter((s) => s.kind !== "key");

  // Only what fits. A paragraph costs about three lines and a call costs one, so
  // take from the newest end until the budget runs out. The log then fills from
  // the top like a fresh session and rolls once it is full, which is what a chat
  // window does. Anchoring it to the bottom instead would leave a void above the
  // first few lines and make the pane look broken before anything happened.
  const BUDGET = 13;
  let spent = 0;
  let cut = all.length;
  for (let i = all.length - 1; i >= 0; i--) {
    spent += all[i].kind === "tool" ? 1 : 3;
    if (spent > BUDGET) break;
    cut = i;
  }
  const shown = all.slice(cut);

  return (
    <div className="flex h-full flex-col bg-app-panel @5xl:border-r @5xl:border-app-border">
      <div className="flex items-center gap-2 border-b border-app-border px-3.5 py-2">
        <span className="text-[10px] tracking-[0.14em] text-app-muted uppercase">
          Your agent
        </span>
        <span className="ml-auto font-mono text-[10px] text-app-muted">
          mcp · 127.0.0.1
        </span>
      </div>

      {/* Fills from the top and rolls when full. */}
      <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-3.5 py-3 @5xl:justify-start @5xl:py-3.5">
        {shown.map((m, i) => {
          // The line that just landed is the one the reader is being asked to
          // connect to the editor, so it is the only one at full strength.
          const latest = i === shown.length - 1;
          // The speaker is named once per turn. Repeating it above every
          // paragraph reads like a transcript, not a conversation.
          const opensTurn = i === 0 || shown[i - 1].kind === "tool";
          return m.kind === "tool" ? (
            <div
              key={i}
              className={`flex items-baseline gap-2 border-l py-0.5 pl-2.5 transition-opacity duration-500 ${
                latest
                  ? "border-app-accent opacity-100"
                  : "border-app-accent/40 opacity-55"
              }`}
            >
              <span className="font-mono text-[11px] text-app-accent">
                {m.text}
              </span>
              {m.detail ? (
                <span className="truncate font-mono text-[11px] text-app-muted">
                  {m.detail}
                </span>
              ) : null}
            </div>
          ) : (
            <div
              key={i}
              className={`transition-opacity duration-500 ${
                latest ? "opacity-100" : "opacity-55"
              }`}
            >
              {opensTurn ? (
                <p className="mb-1 text-[10px] tracking-[0.14em] text-app-muted uppercase">
                  Claude
                </p>
              ) : null}
              <p className="text-[12.5px] leading-relaxed text-app-text">
                {m.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
