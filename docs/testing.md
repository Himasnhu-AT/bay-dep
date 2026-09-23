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

**The agent can propose and apply an edit.**

```bash
agent-browser --session bay snapshot -i                # find the rail's button "Agent" → @ref
agent-browser --session bay click @e21                  # (the ref from that snapshot)
agent-browser --session bay fill textarea "Put a 12-frame fade-in on the first clip. Propose it and wait."
agent-browser --session bay click 'button[aria-label="Send"]'   # the round send button has no text
# poll: eval "window.bayEngine.store.getState().agentRunning" until false
agent-browser --session bay eval "window.bayEngine.store.getState().agentProposal?.options.map(o => o.label)"
agent-browser --session bay find text "Approve" click
# poll again, then read the item and s.agentGate.approved.consumed; undo afterwards
```

**A template fits the canvas.** Templates rail → expand one → fill its fields → *Add to
timeline*; `tab t1` if agent-browser jumped to the render window; set the playhead into the
clip; screenshot and look.

**A sound is in the export.** Export a WAV through `window.bayMcp.execute({ tool:
'export_timeline', … })`, poll `track_export` until `done`, then measure the file with the bundled
ffmpeg (`require('ffmpeg-ffprobe-static').ffmpegPath`) — decode to raw samples and check the
level per frame, not "a file exists".

## The `test/app` probes

`test/app/*.mjs` are scripted regression checks over CDP (`node test/app/<name>.mjs` against a
running `./run.sh` instance). Run them as gates after a change; write new app-level checks with
agent-browser. [`test/app/README.md`](../test/app/README.md) collects the measurement traps they
were built around. `mcp-during-reload.mjs` reloads the editor on purpose, repeatedly — expect the
window to flash while it runs, and do not run it while someone is working in the app.
