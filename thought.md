# thought.md — next improvements to bay's in-app agent

Written 2026-09-23, to be picked up in a later session. **No code was changed for this note.**
Everything marked *measured* was observed on this machine today; everything marked *unverified*
is a lead, not a fact — check it before building on it.

Four threads, in priority order:

1. The panel goes silent while the model thinks ("stuck for 3 minutes") — fix first.
2. Model, effort and related controls in the UI.
3. A more compact activity view (the streaming box works; everything around it is noisy).
4. Running Claude without spawning the CLI — options and trade-offs.
5. React (Remotion-style) compositions instead of hand-written HTML.

---

## 1. "Stuck for 3 minutes" — it was thinking, and nothing said so

### What happened (*measured*, from the session file)

Session `8f7a9f2a…` in `~/.claude/projects/-Users-himanshu-Library-Application-Support-bay-agent-workspace/`,
after the user wrote "looking good":

```
10:51:17  preview_frame ×2          (results: 44 KB and 41 KB — two images)
10:51:20  …                         ← panel shows nothing from here
10:53:44  +143.9 s  thinking (0 chars stored), text 108 chars   output_tokens = 26,894
10:53:53  write_composition 2.7 KB
10:54:05  write_composition 3.7 KB   … six in total, 12–20 s apart (these did stream)
```

So: **2 min 24 s of extended thinking, ~27k output tokens, and the panel had nothing to draw.**

### Why nothing showed (*measured*)

The CLI stream *does* announce the thinking block — `content_block_start {type: "thinking"}` — but
every `thinking_delta` arrives with **0 characters**; only a `signature_delta` carries bytes. Current
models default to thinking `display: "omitted"`: the thinking happens and is billed, its text is
never sent. `src/main/agent/stream.ts` ignores `content_block_start` for thinking and drops empty
deltas, so the panel sees no event at all until the next text or tool block.

Tried and **did not help** (*measured*, `--print` mode): `--settings '{"showThinkingSummaries":true}'`
— still 0 chars. The binary also contains `CLAUDE_CODE_THINKING_DISPLAY_UPDATES` and
`alwaysThinkingEnabled` (*unverified* what they do).

### What to build

- **Always show that it is thinking.** Map `content_block_start {type:"thinking"}` to a new
  `AgentEvent` (`{type:'thinking-start', runId}`), and end it at the next block start. The panel
  shows a live line: *"Thinking · 1m 12s"* with the elapsed time ticking. This alone would have
  turned "stuck" into "working". Cheap, CLI-compatible, testable in `stream.test.ts`.
- **Show how much.** The final `message_delta` carries `usage.output_tokens`; show it on the
  settled line ("Thought for 2m 24s · 27k tokens"). Mid-stream token counts are *not* in the
  stream (*measured*: only one `message_delta`, at the end).
- **Readable thinking needs the API path** (see §4): the Messages API takes
  `thinking: {type: "adaptive", display: "summarized"}` and streams a readable summary. On Claude
  Fable 5.1 / Mythos 5.1 / Fable 5 there is also `display: "updates"` (beta
  `thinking-display-updates-2026-08-18`): short progress notes between tool calls. Worth checking
  whether the CLI exposes either (*unverified*: `CLAUDE_CODE_THINKING_DISPLAY_UPDATES`).
- **Less thinking where it isn't needed.** The long think followed two image-heavy
  `preview_frame` results (85 KB). Consider: smaller preview images for the agent (a 540 px frame
  is enough to judge layout), and a lower default effort for editing turns (§2).
- **Behaviour note:** the agent wrote **six** compositions although `/short-form` says ONE. Each
  was a separate 12–20 s write. Either tighten the skill ("one composition covering the whole clip;
  do not split per graphic") or give it a template (§5) so there is less HTML to write at all.
- **Status bar confusion:** while the agent was working the footer said "agent idle". That line is
  the *MCP socket* status (terminal clients), not the panel's agent. Rename it ("MCP: idle") or
  show the in-app agent's state there.

---

## 2. Model, effort and friends in the UI

What the CLI accepts today (*measured*, `claude --help`):

| Flag | Values | Notes |
|---|---|---|
| `--model` | alias (`sonnet`, `opus`, `haiku`, `fable`) or full id | `init` reported `claude-sonnet-5` for `sonnet` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | per session |
| `--fallback-model` | a model | automatic fallback when overloaded |
| `--forward-subagent-text` | — | subagent text/thinking into the stream |

Current API model ids (from the claude-api reference, cached 2026-06-24): `claude-fable-5-1`,
`claude-opus-5`, `claude-opus-5-5` (launching), `claude-sonnet-5`, `claude-haiku-4-5`. Effort is
`output_config.effort` on the API; the default is `high` (Opus 5.5: `medium`).

Proposal:

- **Settings → Agent:** default model (Sonnet 5 / Opus 5 / Fable 5.1 / Haiku 4.5) and default
  effort (low…max), with one line each on cost and speed. Persist like the other prefs
  (`store/prefs.ts`; remember the keys are a compatibility surface — pin them in
  `settings-keys.test.ts`).
- **Composer chip:** the current model and effort, click to change for the next message. Effort is
  per session in the CLI, so changing it means restarting the runtime with `--resume` (it already
  resumes by session id — `cli.ts` `cliArgs(..., resume)`); model likewise. On the API path, effort
  can change per message without breaking the cache (per-message effort beta, Fable 5.1 / Opus 5).
- **Show cost.** The CLI's `result` message carries `total_cost_usd` and `usage`; show it per turn
  in the panel (small, muted) and per conversation in the export. Useful when someone picks `max`.
- **Sensible defaults for editing:** most edit turns are tool-calling, not deep reasoning. Measure
  `medium` vs `high` on a handful of real turns before changing the default (per the reference:
  "tune per route, measure on real requests").
- Plumbing: `CliOptions` gains `model`, `effort`, `fallbackModel`; `sdk.ts` maps the same to its
  options. Both runtimes already share `childEnv` and `bayMcpServer`, keep them sharing.

---

## 3. A more compact activity view

The streaming box (Image 17) is right: file name, size, the HTML arriving. What makes the panel
long is everything *around* it:

- **Internal tools as rows.** `ReadMcpResourceTool`, `ListMcpResourcesTool` appear as full cards
  and repeat. Collapse consecutive tool calls into one line per run, labelled in words:
  *"Read 3 guides · checked 2 frames"*, expandable. Name resources by what they are
  ("guide: editing", "template: subtitle") instead of the tool name.
- **One live card at a time.** Only the call in progress is expanded (the streaming box); finished
  calls fold into the run summary. Six `write_composition` calls become *"Wrote 6 graphics"* with a
  per-file list inside.
- **Shorter box.** 6–8 lines of tail is enough; keep the size counter; make it follow the newest
  line (it does) and stop re-rendering the whole log on each delta (memo the finished entries — the
  log re-renders on every `tool-input`/`text` delta today).
- **Tool names in words everywhere.** `set_canvas` → "Made the frame vertical", `place_asset` →
  "Placed the clip", from a small table beside the catalog (`src/shared/mcp.ts`), tested so a new
  tool can't ship without a label (same pattern as the dry-run gate).
- **Thinking line** from §1 sits in the same activity strip.
- Keep the transcript export complete — compaction is a view, not a change to `agentLog`.

---

## 4. Claude without spawning the CLI — the options

What bay does now: `src/main/agent/cli.ts` spawns `claude --print --output-format stream-json …`
(default), or `BAY_AGENT_RUNTIME=sdk` uses `@anthropic-ai/claude-agent-sdk`.

**The Agent SDK spawns too** (*measured*, v0.3.278 `sdk.mjs`: `child_process`, `spawn(`,
`pathToClaudeCodeExecutable`). It launches the bundled Claude Code executable. What it adds over
raw spawning:

- `spawnClaudeCodeProcess(options)` — replace *how* it spawns (e.g. an Electron `utilityProcess`,
  a VM). Still a separate process.
- `createSdkMcpServer` + `tool()` — **bay's tools in-process**: no proxy bundle, no unix socket,
  no `bay-agent.sock`. That removes the whole transport layer (and its staleness gates) for the
  in-app agent, while terminal clients keep the socket. Strong candidate on its own.

Three real alternatives, from least to most change:

| Route | Spawns? | Auth | What you keep | What you lose / must build |
|---|---|---|---|---|
| **A. Agent SDK + in-process tools** (`createSdkMcpServer`) | yes (hidden) | the user's Claude login | Claude Code harness: skills, sessions/resume, compaction, permissions, `--tools` sandbox | nothing; mostly deletes code (proxy, socket, stream parsing becomes typed messages) |
| **B. SDK browser build** (`@anthropic-ai/claude-agent-sdk/browser`, alpha) | **no** — connects over WebSocket/SSE to a Claude Code session running in Anthropic's cloud (CCR), with in-process `createSdkMcpServer` tools | OAuth token | the harness, run remotely | alpha; needs a cloud session per conversation; tools must reach the app; offline editing stops working |
| **C. Messages API directly** (`@anthropic-ai/sdk`, tool runner `client.beta.messages.toolRunner` + `betaZodTool`) | **no** | an **API key** (or `ant auth login` profile) — *not* the user's Claude subscription | full control: `thinking: {type:"adaptive", display:"summarized"}` (readable thinking, fixes §1 properly), `output_config.effort` per request or per message, `eager_input_streaming: true` on tools (tool input streams — what §3's box shows), prompt caching of the 33-tool catalog + system prompt (`cache_control`, verify with `usage.cache_read_input_tokens`), compaction beta for long sessions | the Claude Code harness: skills loading, session files, CLAUDE.md handling, permission modes — bay would own the loop, history and skills injection itself |

Recommendation for the next session: **do A now** (in-process tools; delete the socket hop for
the panel), and **prototype C behind a setting** for users with an API key, because C is the only
route that gives readable thinking, per-message effort and caching control. B is interesting but
alpha and cloud-bound; revisit when it is stable.

Things to settle before C:

- Billing model: API key usage vs Claude subscription — a product decision, not a technical one.
- Skills: bay's skills are text (`src/shared/skills.ts`); on C they become system-prompt sections
  or on-demand tool results ("load_skill"), not `.claude/skills/` files.
- History: API is stateless — keep the transcript in main, append full `response.content` (thinking
  blocks must be passed back unchanged), and keep it append-only (preserved-thinking rules on the
  newest models reject edited history).
- Validation: with `eager_input_streaming`, validate every tool input against the schema before
  running it (bay's `validateArgs` already does — keep it on that path).
- Refusals: check `stop_reason` (`refusal`) before reading content; consider server-side
  `fallbacks` for Opus 5 / Fable 5.1.

---

## 5. React compositions (Remotion-style) instead of hand-written HTML

Why: today the agent writes a whole HTML document with a hand-rolled `time(t)` per composition —
the six 3–6 KB documents above took ~90 s of generation. LLMs know Remotion's API well
(`useCurrentFrame`, `interpolate`, `spring`, `<Sequence>`, `<AbsoluteFill>`); a component is
shorter, and timing by frame is what bay already thinks in.

Options:

1. **Real Remotion** (`remotion` + `@remotion/player`): mount the agent's component in a
   composition page and drive the Player's frame from bay's `time(t)` contract; keep bay's capture
   and export path. *Check the licence first*: Remotion is free for individuals and small
   companies, and needs a company licence above that (*unverified* current terms — read
   remotion.dev/license before adopting).
2. **A small bay runtime with the same shape** — `useFrame()`, `interpolate()`, `spring()`,
   `<Seq from dur>`, `<Fill>` — a few hundred lines, no licence question, and it fits the
   sandboxed composition windows (no network, everything local). The agent writes TSX; main bundles
   it with esbuild into a composition page that follows the existing contract, so preview, the live
   pool, export and `read_composition` faults all keep working unchanged.

Either way the pieces are the same: a `write_component` tool (TSX in, bundled HTML out, with
compile errors returned as recovery instructions), the composition sandbox unchanged (bundle
everything; no CDN), and templates rewritten as components (the subtitle designs and the short-form
top band are good first candidates — the band's six element types become six components the agent
fills with words and times instead of writing CSS).

Measure before committing: time-to-first-frame and tokens for the same graphic as HTML vs TSX on a
few real prompts.

---

## Evidence and commands, for whoever picks this up

- Session timeline: parse the jsonl above (`timestamp`, `message.content[].type`, `usage.output_tokens`).
- Thinking deltas are empty: `echo "<prompt>" | claude --print --model sonnet --output-format stream-json --verbose --include-partial-messages --tools ""` and count `thinking_delta` characters.
- SDK spawns: `grep -o "child_process\|spawn(\|spawnClaudeCodeProcess\|createSdkMcpServer" node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@*/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs | sort | uniq -c`
- Browser/bridge transports: `browser-sdk.d.ts` (`WebSocketOptions`, `SSEOptions`), `bridge.d.ts` (alpha, CCR session handles), same package.
