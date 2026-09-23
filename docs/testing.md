# Testing bay

There are four gates, and each one makes a different claim. Passing one says nothing about the
others — that is the most expensive lesson in [`CLAUDE.md`](../CLAUDE.md).

| Gate | Command | What a pass means |
|---|---|---|
| Types | `pnpm typecheck` | main, preload, shared and renderer compile. The **only** gate for code that imports `electron`. |
| Unit | `pnpm test` | the pure modules behave. Says nothing about the running app. |
| Build | `pnpm build` | the bundler accepts the tree (a barrel that does not re-export fails here and nowhere else). |
| App | **agent-browser** against `./run.sh` | the thing a person uses actually does it. |

**To test the running app, use `agent-browser`.** Not a new hand-written CDP script, not a
screenshot you eyeball, not "the unit test passes". Every fault this project found in a running
app — an agent that could not edit, frames it could not see, a dissolve that was a hard cut in the
exported file, a window reload that stranded a call — was invisible to the unit suite.

---

## 1. Run exactly one current instance

```bash
./run.sh              # build, stop any running bay, start one with CDP on 9222
./run.sh --no-build   # restart what is already in out/ (say that you did)
./run.sh --stop
```

**The access gate, and the dev bypass.** bay is invite-only (`src/main/auth/`, `src/shared/access.ts`):
until an account with access signs in, the window shows the access screen, main refuses every
editor IPC channel, and both MCP sockets answer every tool call with *"bay is locked: … open the bay
window and sign in …"*. `./run.sh` launches with `BAY_ACCESS=dev`, which skips the check so the
probes work unchanged; launching `electron .` by hand needs it too:

```bash
BAY_ACCESS=dev ./node_modules/.bin/electron . --remote-debugging-port=9222 …   # probes: gate off
./run.sh --gate                                                               # the real sign-in screen
BAY_ACCESS_NO_BROWSER=1 ./run.sh --gate   # Sign in logs the URL instead of opening a browser
```

Both switches are honoured **only when `app.isPackaged` is false** (`src/main/auth/build.ts`,
held by `build.test.ts`); an installed bay ignores them and says so in its log. The access screen
is `data-access-state=<state>` on its card, and `window.bay.access.status()` answers even while
locked. `BAY_SITE=local` (unpackaged only) sends the browser to the website's dev server on
`localhost:3000` instead of bay.everholt.com.

`electron .` compiles nothing, and a running process keeps the main bundle it started with. After
changing main-process code you need a **restart**, not only a build. Read the first line `run.sh`
prints: if the typecheck failed, nothing launched, and anything you "test" next is measuring the
previous build — or nothing.

## 2. Connect agent-browser — always with its own session

```bash
agent-browser --session bay connect 9222
agent-browser --session bay tab          # must show `bay - file:///…/out/renderer/index.html`
```

**Always pass `--session bay`.** agent-browser's default session is shared by every process on the
machine. During this project another agent's `open http://localhost:3123` landed on bay's window
through the shared default session and navigated the editor away to a different website. bay then
correctly marked the window not-ready and every tool call timed out after 45s. A private session
name is what keeps your commands on your window and other people's off it.

Check `tab` before you trust anything. If it lists a page that is not bay's `index.html`, you are
driving the wrong thing; `./run.sh --no-build` restores the editor.

**bay opens on its projects screen, with no project open.** Open one before testing the editor —
click its card, or:

```bash
agent-browser --session bay snapshot -i                    # the project cards are buttons
agent-browser --session bay find text "Smoke test" click   # or click the card's @ref
```

Every agent tool except `list_projects` and `open_project` is refused until a project is open,
and `test/app/cdp.mjs`'s `attach()` opens the most recently edited project for the probes.

## 3. Drive it like a person

```bash
agent-browser --session bay snapshot -i            # interactive elements with @refs
agent-browser --session bay click @e24             # e.g. the Templates rail button
agent-browser --session bay fill @e68 "Jane Goodall"
agent-browser --session bay find text "Approve" click
agent-browser --session bay press m                # keyboard shortcuts go to the focused element
agent-browser --session bay screenshot shot.png
```

Prefer these over setting store state: the point is to exercise the path a person takes — the
composer's Send, the card's Approve, the panel's Add to timeline.

## 4. Read state to know what happened

`window.bayEngine` exists once `localStorage['bay.debug'] = '1'` has been set and the page loaded
with it (any `test/app` probe sets it; it persists). Then:

```bash
agent-browser --session bay eval "(() => {
  const s = window.bayEngine.store.getState()
  const tl = s.project.timelines[0]
  return { tracks: tl.tracks.map(t => t.name + ':' + t.items.length), past: s.past.length }
})()"
```

- **Read after, not through a snapshot taken before.** `const s = getState(); s.undo(); s.project`
  is the project *before* the undo. Call `getState()` again.
- `window.bayMcp.execute({ id, tool, args })` runs a tool through the real executor, with the
  approval gate and validation, without a socket — use it to separate "the tool is wrong" from
  "the transport is wrong".
- `window.bayEngine.engine.levels()` gives per-track audio RMS, for checking sound in preview.

## 5. Leave the project as you found it

Undo everything you did, and never save:

```bash
agent-browser --session bay eval "(() => { const st = window.bayEngine.store;
  while (st.getState().past.length) st.getState().undo(); return st.getState().past.length })()"
```

The project on disk only changes if something saves. A probe that saves has mutated the fixture
every later check depends on.

---

## Traps, each one hit for real

- **agent-browser follows new windows.** Placing an HTML composition opens a hidden render
  window, and agent-browser switches to it: a screenshot comes back as a blank 3840×2160 page
  that reads as "the editor is broken", and `window.bayEngine` is undefined. `tab t1` goes back.
- **It cannot hold a modifier through a drag.** Alt-drag slip/slide/roll must be exercised by
  dispatching `PointerEvent`s with `altKey: true` from `eval`. Report it as that — it tests the
  handler, not the OS delivering the modifier.
- **`record` does not work on Electron** (it needs a new browser context, which Electron refuses).
  To catch something transient, sample it in the page instead — e.g. read one canvas pixel every
  `requestAnimationFrame` — and prove the sampler with a positive control first: make a real
  change and confirm the sampler sees it, or its silence means nothing.
- **`fill <sel> ""` does not clear a field.** The box keeps its text and React never hears a
  change, so a search stays applied and the screen looks like it lost data (it has not — read
  the input's `.value`). Clear a field through the app's own control: the search box has
  *Clear search* and Escape. Pressing `Meta+a` then `Backspace` did not clear it either.
- **Scope a selector to the thing you mean.** `[role=listbox]` also matches every timeline track
  (`V1 clips`, `A1 clips`), so "is the composer's menu open?" read *true* after the menu had
  closed. Ask the control itself — the composer's textarea carries `aria-expanded` — or select by
  the menu's own `aria-label`.
- **Never `open <url>` in bay's session.** It navigates the editor away; the project in memory
  goes with it.
- **To learn whether something reloaded the page,** set a marker and look for it afterwards:
  `eval "window.__marker = 1"`, do the thing, `eval "window.__marker"`. That is how the
  "screen flickers when the agent count goes up" report was traced: tool calls and agent-browser
  commands kept the marker; every `test/app` probe's attach reloaded the page. The count was a
  coincidence — probes also connect.
- **A check of the preview is not a check of the export.** `transition-audio.mjs` meters preview
  analysers; export was hard-cutting dissolves the whole time. When the output is a file, render
  it and measure the file (see `src/main/export/audio-render.test.ts`).
- **The in-app agent needs `claude` signed in** and costs real tokens; ask it for small, cheap
  edits, and read its log from `s.agentLog` rather than scraping the panel.

## Recipes

**The agent edits directly, and the Changes card reverts it** (the default since *Ask before
editing* became opt-in). No model needed: a turn is only the events the runtime would emit
(`AgentEvent` in `src/shared/agent.ts`), and an edit made through `window.bayMcp.execute` while
a turn is running counts as the agent's.

```bash
agent-browser --session bay eval "(() => { const s = window.bayEngine.store.getState()
  s.setPanel('agent'); s.startAgentSession()
  s.applyAgentEvent({ type: 'started', runId: 'probe' }); return s.agentApproval })()"   # false: ungated
agent-browser --session bay eval "window.bayMcp.execute({ id: 'x', tool: 'add_track', args: { kind: 'video' } })"
agent-browser --session bay eval "(() => { const s = window.bayEngine.store.getState()
  s.applyAgentEvent({ type: 'done', runId: 'probe', reason: 'complete' })
  return window.bayEngine.store.getState().agentLog.at(-1) })()"   # re-read, not s: { kind: 'changes', lines: [{ text: 'Added track V2' }], state: 'applied' }
agent-browser --session bay find text "Revert" click
agent-browser --session bay eval "(() => { const s = window.bayEngine.store.getState()
  return { state: s.agentLog.at(-1).state, toast: s.toast?.text } })()"   # 'reverted', 'Reverted. ⌘Z to undo.'
```

Then undo the revert's own history entry and the track (section 5), and `endAgentSession()`.
Measured with these store calls and the card's Revert button clicked in the page (not yet through
`find text`): the track count went 2 → 3 → 2 and the card read *Reverted*. `reason: 'stopped'` or
`'error'` adds an error entry after the card; a turn that changed nothing leaves no card.

**The agent can propose and apply an edit** — only with *Ask before editing* on. Since the agent
edits directly by default, a session without it has no gate, no proposal card and nothing to
Approve; this recipe then just watches the agent make the edit. Turn it on first, and put it
back after (it is remembered in `localStorage['bay.agentApproval']`, so leaving it on changes
the user's app):

```bash
agent-browser --session bay eval "(() => { const s = window.bayEngine.store.getState()
  const was = s.agentApproval; s.setAgentApproval(true); return was })()"   # note it
agent-browser --session bay snapshot -i                # find the rail's button "Agent" → @ref
agent-browser --session bay click @e21                  # (the ref from that snapshot)
agent-browser --session bay fill textarea "Put a 12-frame fade-in on the first clip. Propose it and wait."
agent-browser --session bay click 'button[aria-label="Send"]'   # the round send button has no text
# poll: eval "window.bayEngine.store.getState().agentRunning" until false
agent-browser --session bay eval "window.bayEngine.store.getState().agentProposal?.options.map(o => o.label)"
agent-browser --session bay find text "Approve" click
# poll again, then read the item and s.agentGate.approved.consumed; undo afterwards
agent-browser --session bay eval "window.bayEngine.store.getState().setAgentApproval(false)"   # or what it was
```

**A template fits the canvas.** Templates rail → expand one → fill its fields → *Add to
timeline*; `tab t1` if agent-browser jumped to the render window; set the playhead into the
clip; screenshot and look.

**A sound is in the export.** Export a WAV through `window.bayMcp.execute({ tool:
'export_timeline', … })`, poll `track_export` until `done`, then measure the file with the bundled
ffmpeg (`require('ffmpeg-ffprobe-static').ffmpegPath`) — decode to raw samples and check the
level per frame, not "a file exists".

## Debug mode and agent transcripts

View → **Toggle Debug Mode** (⌥⌘D) turns on reporting tools, marked by a **Debug** tag in the
status bar. With it on, the Agent panel's **Export transcript** writes a folder in Downloads:

- `transcript.md` — the conversation as the user saw it: turns, every tool call with its
  arguments and result, and proposals with their operations.
- `panel.json` — the same log, raw, plus the session id.
- `claude-session.jsonl` — Claude Code's own session file, found by that id: what the *model*
  saw, including pinned context and the skill bodies it loaded. Compare the two when the agent
  seems to have misread a request.

With agent-browser, turn it on through the store — menu accelerators (⌥⌘D, and ⌘, for
Settings) belong to the native menu and do not reach the page from agent-browser:

```bash
agent-browser --session bay eval "(() => { const s = window.bayEngine.store.getState()
  s.toggleDebugMode(); return window.bayEngine.store.getState().debugMode })()"
```

or open Settings (`window.bayEngine.store.getState().setSettingsOpen(true)`) and click its
**Debug mode** switch. `button[title^="Debug mode"]` is **not** the toggle: it is the Agent
panel's *Export transcript* button, which only exists once debug mode is already on — so it is
how you export, not how you switch it on. Toggle it back off when you are done.

## The `test/app` probes

`test/app/*.mjs` are scripted regression checks over CDP (`node test/app/<name>.mjs` against a
running `./run.sh` instance). Run them as gates after a change; write new app-level checks with
agent-browser. Exit 0 is right, 1 is a finding, 2 is "could not measure"; a few are marked
*report, no verdict* and exit 0 whenever they measured. Every probe that attaches restores the
project, its undo history, dirty flag, agent state and any patched prototype when it ends —
`[cdp] restored: …` is its last line; anything else there is worth reading. The full list, with
what each needs, is the table in the README. [`test/app/README.md`](../test/app/README.md) collects the measurement traps they
were built around. `mcp-during-reload.mjs` reloads the editor on purpose, repeatedly — expect the
window to flash while it runs, and do not run it while someone is working in the app.
