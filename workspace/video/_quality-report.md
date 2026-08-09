# Quality report — video scripts

**Scripts covered:** `short-form/x-loop-60s.md`, `long-form/the-uncut-build.md`
**Date:** 2026-08-08

---

## Gates, per script

| Gate | The loop | The uncut build |
|---|---|---|
| Hook in first 3 seconds | ✅ Cold open mid-build, caption at 0.5s | ✅ Cold open, no title card, prompt typed live |
| No "hey guys", no logo intro | ✅ | ✅ |
| One idea per short-form video | ✅ An agent's edits land where you can reach them | n/a, long-form |
| Zero banned words | ✅ | ✅ |
| Zero AI slop | ✅ | ✅ |
| CTA present, not forced | ✅ `/status`, once, at the close | ✅ `/status`, once, at the close |
| Visual direction included | ✅ Per beat | ✅ Per section |
| Platform-appropriate length | ✅ 55 to 60s for muted autoplay | ⚠️ Length is unknown until step 0 runs |
| **`VOICE.md` compliance** | ✅ | ✅ |

### Voice checks on every line of on-screen text and copy

| Check | Result |
|---|---|
| Em dashes and en dashes | ✅ Zero |
| Rule of three | ✅ Zero |
| Promotional adjectives | ✅ Zero |
| `-ing` tails | ✅ Zero |
| Negative parallelism | ✅ Zero |
| Sentence case | ✅ |
| Product name hardcoded | ⚠️ Present in the X post and the YouTube description, where a variable cannot be interpolated. Unavoidable in a social caption. Keep it out of anything rendered by the site, and out of file names |
| Swap test | ✅ Every caption fails to work for a competitor. "⌘Z undoes its edits like any other" is the strongest |

---

## Where this plan deviates from the skill, and why

| Skill default | What was done instead | Reason |
|---|---|---|
| TikTok, Reels, Shorts | X, YouTube, the site, the README | The ICP in `MARKETING.md` is a developer on Apple Silicon running an MCP client. TikTok reaches the anti-ICP. The growth plan commits to one channel done properly |
| Hook formulas: contrarian, bold claim, curiosity gap | The product working, cold, with one factual caption | Every listed formula is promotional register, which `VOICE.md` bans outright. "Visual surprise" is the one formula in the table that survives, and it is the honest one |
| Cut every 2 to 3 seconds for pace | 4 to 6 cuts across 60s, and one take for the long cut | The pacing advice is written for TikTok. Applied to a product demo it reads as a tool that needs help holding attention. The long cut's whole value is that it has no cuts to hide anything in |
| Trending audio | Silent | Muted autoplay, and a trending sound on a developer tool demo reads as a costume |
| Talking head, thumbnail with facial expression | Neither | No face, no studio, and the register is quiet |
| Hashtags | None | On X they read as a reach play to this audience |
| Clipping plan from existing long-form | A prospective plan keyed to script beats | No footage exists. This is stated at the top of the clipping plan and every locator is marked for replacement |

---

## Blockers before any of this can be shot

1. **Step 0, the wall clock.** Three numbers, from `_video-plan.md`. Every length in both
   scripts is provisional until they exist, and the long cut's honesty depends on them.
2. **The A-versus-B decision.** Shoot with a real agent (B) or the Python script (A). The
   recommendation is B for the hero with A as the safety net, and the reasoning is in
   `_video-plan.md`. If B will not run reliably, that is a product finding, not a video problem.
3. **The tool count.** 24 in the code, twenty-one on the live site, 16 in the recipe. Fix the
   repo before the video repeats a number from the wrong source.

---

## Corrections made to earlier work in this session

**`workspace/landing-pages/bay-home.md` printed "twenty-one tools" in two places.** The true
count is 24, from `definitions()` in `rust/crates/bay-mcp/src/tools.rs`. The number was inherited
from `website/PRODUCT.md` and the live site, both of which are wrong. The landing page copy has
been corrected and a note added.

This is the second count in the repo that has drifted from the code, after 383 versus 386 tests
in `parity-status.md` versus `todo.md`. Two independent drifts is a pattern rather than a slip.
**The durable fix is to stop hand-writing counts.** Generate the tool count from
`definitions().len()` and the test count from the suite, or print neither. On a site whose second
rule is that nothing may describe behaviour the app does not have, a number a visitor can check
and find wrong costs more than the number was ever worth.
