/**
 * Choosing which window an MCP tool call is delivered to.
 *
 * Pure, and in its own file, because the rule it encodes cost a day. `server.ts` imports
 * `electron`, so nothing in it is reachable from `pnpm test`; the decision that actually
 * matters therefore had no test at all and was wrong in a way nothing could see.
 *
 * What it was: "the first window that is not destroyed". Correct while bay had one window.
 * The moment a composition renders, it renders in a hidden `BrowserWindow` — which is in
 * `getAllWindows()` too — and whichever came back first received the tool call. A composition
 * page has no MCP listener, so the call was never answered, main waited out its thirty second
 * timeout, and the report was "bay did not answer". Main was healthy. The renderer was healthy.
 * The socket was healthy. The tool was fine. Every tool simply stopped working the instant a
 * composition appeared on the timeline, and nothing anywhere logged a word.
 */

/** The minimum a window must tell us to be choosable. */
export interface WindowLike {
  destroyed: boolean
  /** True for the hidden windows compositions render in. */
  composition: boolean
}

/**
 * The window holding the editor, or null when there is not one.
 *
 * Null is a real answer and not a failure: during startup, and after the last window closes,
 * there is genuinely nowhere to send a call. The caller reports that as a refusal an agent can
 * act on rather than waiting out a timeout to discover it.
 */
export function pickExecutorWindow<T extends WindowLike>(windows: readonly T[]): T | null {
  return windows.find((window) => !window.destroyed && !window.composition) ?? null
}
