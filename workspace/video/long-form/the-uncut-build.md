# The uncut build

**Platform:** YouTube, unlisted at first. The proof link.
**Length:** as long as it truly takes. Target 3 to 6 minutes.
**Format:** one take, screen recording, two panes. Trims at the head and tail only.
**Goal:** let a skeptic verify the claim at their own pace.

> This cut has one job the loop cannot do: **survive scrutiny.** The loop is cut, so a skeptic
> can assume the cuts hide something. This one has no cuts to hide anything in.

---

## The standard this cut is held to

One take. No re-ordering. No silent speed changes. If the render takes three minutes and forty
seconds, either it stays in at three minutes and forty seconds, or a caption says exactly what
was done to it and for how long.

That is not a stylistic preference. `docs/native/reel-recipe.md` records four defects that were
found by *looking at a rendered frame* rather than by a test, and `todo.md` splits into three
files because "done", "not built" and "built but never run" are different states. A video that
quietly compresses time is the same category of error the project has already decided not to
make.

---

## COLD OPEN — 0:00 to 0:20

No title card. No logo. The screen is already the working environment: agent on the left, editor
on the right, empty project.

**On screen, one line, then gone:**

> One take. Nothing below is sped up or re-ordered.

**Then the prompt is typed, live, at typing speed.** Use the same prompt the site's sequence
section already shows, so a visitor arriving from the home page recognises it immediately.

**Direction:** do not paste the prompt. Watching it typed sets the clock honestly and tells the
viewer nothing was prepared off camera.

---

## SECTION 1 — the calls start landing (0:20 to ~1:30)

Both panes visible, neither zoomed. The agent begins calling. `project_create` first, because
the tool description says to call it first and the viewer can read that.

**What to let the viewer notice, without narrating it:**
- The calls have plain names. `add_shape`, `animate`, `add_text`.
- Each one produces something visible within a beat.
- The `● Claude` chip fires and fades on its 2.5 second timer.

**Caption, once, around 0:50:**

> These are the same commands a click produces. There is no second code path.

**If a call fails here, keep it.** Caption it plainly: `That one failed. Watch what it does
next.` A recovered failure is the most persuasive thing that can happen in this video and it
cannot be staged, because a staged one is a re-creation.

---

## SECTION 2 — you take it back (~1:30 to ~2:10)

**The section the video exists for.** Stop the agent. Take the mouse.

1. Drag a clip the agent placed. It moves like any clip, because it is one.
2. Open the inspector on an element the agent created. Change one value by hand.
3. Press ⌘Z twice. The hand edit comes off. Then the agent's edit comes off.

**Caption:**

> Its edits and mine are on the same undo stack.

**Direction:** go slowly here. The instinct is to hurry the part you have shown yourself a
hundred times. This is the first time the viewer has seen it, and it is the only moment in the
video a competitor could not shoot.

---

## SECTION 3 — it renders (~2:10 to the end)

Let the agent finish. `render` fires.

**This is where the wall clock decides the cut.** Three honest options, in order of preference:

| If render takes | Do this |
|---|---|
| Under ~90s | Leave it in, in full. The wait is part of the honesty |
| 90s to ~5min | Leave it in, with a progress caption. `Rendering. 3m 40s, real time.` |
| Over ~5min | Cut, and caption the cut on screen: `Cut here. 6m 12s of rendering removed.` Then show the file's timestamp on the other side so the claim is checkable |

**Never** speed it up without saying so. The third option is honest because it names the number.
A 4× speed ramp with no caption is not.

**End on the file.** Show it in Finder, with its size and its duration. Then play it, full frame,
with its own audio, all the way through. All 21.429 seconds.

---

## CLOSE — the last 30 seconds

Cut to the paper card.

> That reel is 21.429 seconds, 1080×1920, 30fps, h264 and AAC.
> Building it turned up four defects. Each one now has a test that catches it.
> Both are written down.
>
> bay.everholt.com/status

**Direction:** this is the permission beat. The viewer has just watched something work, and the
close hands them the list of what does not. That order matters. Impressive, then honest, is
credible. Honest, then impressive, sounds like an apology.

---

## Description

```
bay is a video editor for the Mac, written in Rust. The engine that draws the timeline also
runs headless, so an agent can build a cut and render an MP4 with no window open.

This is one take of it building a 21 second infographic reel through 24 MCP tools. Nothing is
sped up or re-ordered. [Adjust this line if section 3 required a cut, and name the number.]

The reel, the four defects the build turned up, and the tests that now catch them are written
up here: [link to docs/native/reel-recipe.md once the repo is public]

What runs today and what is still broken: bay.everholt.com/status

There is no download yet.
```

**Note:** "24 MCP tools" is the true count from `definitions()` in
`rust/crates/bay-mcp/src/tools.rs`. Do not copy the twenty-one from the live site or the sixteen
from the recipe. See `_video-plan.md`.

---

## Timestamps

Fill these from the real capture. The shape:

```
0:00  The prompt
0:20  The calls start landing
1:30  Taking it back by hand
2:10  Rendering
X:XX  The finished reel
X:XX  What is still broken
```

---

## Thumbnail

Two panes, split down the middle: tool calls on the left, timeline on the right, the `● Claude`
chip visible. Four words maximum, set in the site's display face:

> **Nobody touched the timeline**

No face, no arrows, no circled elements, no expression. The playbook's thumbnail advice assumes
a creator channel and does not apply to a product proof link.
