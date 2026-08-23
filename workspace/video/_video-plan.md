# Video plan — the "Volatility Drag" build

**Date:** 2026-08-08 · **Status:** capture plan. **No footage exists yet.**
**Blocking asset for:** the home page, every social post, and the whole Month 1 growth plan.

---

## What this is, and what it is not

This is not a clipping plan. There is no source video to cut from. `website/PRODUCT.md` is
explicit: *there are no screenshots, recordings, renders or frames of the app.* Everything
below is a plan for producing the first frame of footage this project has ever had.

That fact sets the standard. The first footage of a product whose brand is honesty cannot be
staged, re-timed, or assembled from takes that did not happen in that order.

---

## Two findings from the repo that change the plan

### 1. The build is reproducible, which is a gift

`script/build-volatility-drag-reel.py` builds the entire reel through HTTP calls to
`127.0.0.1:7333/mcp`. It is a pure client with no sleeps and no local rendering: *"Every visual
decision is a bay MCP tool call. This script is only the client. Nothing else touches a pixel."*

So the build is deterministic and re-runnable. You can re-shoot as many times as you like and
get the same reel, which means a bad take costs nothing and the "not rearranged" claim stays
true without effort. `script/reel-inkcheck.py` is the dead-air sweep from the recipe notes and
is a second shot in its own right.

### 2. The tool count is wrong in three places, including the live site

| Source | Says | |
|---|---|---|
| `rust/crates/bay-mcp/src/tools.rs` | **24 tools** | ✅ the truth, counted from `definitions()` |
| `website/PRODUCT.md` and the live site | twenty-one tools | ❌ under by 3 |
| `docs/native/reel-recipe.md` | 16 tools | ❌ under by 8, presumably true when written |

The 24: `project_create` `project_info` `fonts_check` `media_import` `add_text` `add_shape`
`add_image` `add_video` `add_audio` `animate` `element_delete` `timeline` `snapshot` `render`
`runtime_status` `runtime_install` `speech_status` `narrate` `subtitles_add`
`subtitles_export` `subtitles_to_video` `project_save` `project_list` `project_load`.

**This is the second count in the repo that drifted from the code**, after 383 vs 386 tests.
The landing page copy in `workspace/landing-pages/bay-home.md` inherited the wrong number from
the live site and has been corrected. Two options, and the second is better: print the true
number everywhere, or generate it at build time from `definitions().len()` so it cannot drift
again. A count nobody can verify is worth less than no count, and a count that is wrong on a
site about honesty is worth less than nothing.

---

## The judgement call: who drives the build on camera?

This is the most important decision in the plan and it is not obvious.

| | **A. The Python script** | **B. A real agent** |
|---|---|---|
| What drives it | `build-volatility-drag-reel.py` posting JSON-RPC | Claude in an MCP client, given a prompt |
| Reproducible | Exactly | No. Different every run |
| Speed | Seconds. No sleeps in the client | Minutes, with thinking pauses |
| Failure risk | Near zero | Real. It may pick different tools or stall |
| Matches the site's framing | **No** | **Yes** |

The site's existing sequence section promises the viewer *"the conversation with your agent and
the calls it makes."* The product claim is that **you describe the change**. A video of a Python
script driving the same endpoint proves the endpoint works. It does not prove the claim, and a
developer will notice the difference in about four seconds.

**Shoot B as the hero. Keep A as the safety net and the B-roll.**

- **B** is the video the positioning requires. Accept that it takes several attempts.
- **A** re-runs identically, so it covers the render shot, the timeline-populating shot, and any
  pickup you need without re-rolling the agent.
- If B cannot be made to work reliably in a week, that is not a video problem. It is a finding
  about the product, and it belongs in `todo.pending.md` rather than being papered over with A.

---

## Step 0, before any capture: measure the wall clock

Run the build once with a stopwatch and record three numbers:

1. Time from the first tool call to the last element landing on the timeline.
2. Time for `render` to produce the MP4.
3. Total, first keystroke to file on disk.

**Every length in this plan is provisional until those three numbers exist.** If the agent-driven
build takes eleven minutes, there is no honest four-minute uncut video, and the choice is a
genuinely long cut or an explicitly captioned time-lapse. Do not silently speed anything up. The
site already claims of its own sequence that *neither side is sped up or rearranged*; footage
that quietly breaks that standard contradicts the page it sits on.

**The rule for this shoot:** any speed change is captioned on screen, in plain words, at the
moment it happens. `Rendering. Real time 3m 40s.` costs one line and protects everything else.

---

## Platforms

The skill's defaults are TikTok, Reels and Shorts. **None of them are used here**, and the
reason is in `MARKETING.md`: the primary ICP is a developer on Apple Silicon who already runs an
MCP client. TikTok reaches the anti-ICP. The growth plan commits to one channel done properly
rather than four half-done.

| Surface | Cut | Role |
|---|---|---|
| **X** (the one channel) | 60s silent loop | The scroll-stopper. Autoplays muted, so it must work with no sound |
| **The home page** | 60s silent loop | Replaces or sits beside the re-created `ScrollSequence` with real footage |
| **YouTube** (unlisted at first) | The uncut build | The proof link. Something to point at in a reply or an issue |
| **The repo README** | 60s loop, as a GIF or a link | Where the ICP actually lands once the repo is public |

Hold Product Hunt and Show HN. Per the growth plan, you fire those once, after a stranger can
install it.

---

## The two cuts

| | **The loop** | **The uncut build** |
|---|---|---|
| Length | 45 to 60s | Whatever it truly takes. Target 3 to 6 min |
| Sound | None. Designed for muted autoplay | The reel's own audio at the end only |
| Cuts | 4 to 6, each captioned | One take. Trims at the head and tail only |
| Script | `short-form/x-loop-60s.md` | `long-form/the-uncut-build.md` |
| Job | Stop the scroll and prove the claim in 8 seconds | Let a skeptic verify it at their own pace |

---

## Capture requirements

**Recording**
- Native resolution, no scaling. A retina capture downscaled to 1080p keeps the type crisp.
- 60fps if the machine allows it. The whole pitch is that the editor does not stutter, and
  30fps capture of a dropped frame is indistinguishable from a capture artifact.
- Hide the desktop, the dock, and every other window. One app, one terminal or client pane.
- **Check the menu bar before rolling.** It is the classic leak: a Slack badge, a personal
  wifi name, a battery at 4%, the clock showing you shot this at 3am.

**The frame**
- Two panes, matching the site's own layout: the agent conversation on the left, the editor on
  the right. The site has already taught the visitor to read it that way.
- The `● Claude · <label>` chip must be visible when it fires. It appears for 2.5 seconds after
  each agent edit and it is the single most convincing detail available. Do not crop it out.
- End on the rendered MP4 playing, full frame.

**Honesty**
- No mock data, no fake project names, no invented file paths.
- If a tool call fails on camera, keep it, and caption it. A recovered failure is worth more
  than a clean take to this audience, and it is the register the whole project is written in.
- Do not hide the known defects if they appear. The media panel showing three demo tiles is a
  published limitation, not a secret.

---

## Kill list

| Rejected | Why |
|---|---|
| Talking-head intro | No face, no studio, and "hey guys" is banned by the playbook and the brand |
| Voiceover selling it | The register is quiet. Let the screen argue |
| Music bed under the build | The reel has its own audio. A second track competing with it is noise |
| Motion graphics over the capture | The product is a motion tool. Decorating its demo with someone else's motion is an own goal |
| Zoom-punch-in edits every 2 seconds | The playbook's pacing advice is written for TikTok. Here it reads as a product that needs help holding attention |
| Speeding up the render silently | Breaks the standard the site sets on its own sequence |
| "Coming soon" end card | There is no date. See `website/CLAUDE.md` |
| A staged failure | Even a real defect, re-created for the camera, is a re-creation. Only keep failures that actually happened in the take |

---

## Output

```
workspace/video/
├── _video-plan.md                      this file
├── short-form/x-loop-60s.md            the 60s silent loop
├── long-form/the-uncut-build.md        the full build
├── clipping-plan/clips-from-the-build.md   what to cut once footage exists
└── _quality-report.md                  gates and scores
```
