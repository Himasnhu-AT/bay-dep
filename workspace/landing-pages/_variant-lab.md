# Variant lab — bay home page

**Date:** 2026-08-08 · **Page:** `/` (rewrite in place, not net-new) · **Traffic:** cold to warm,
mostly developers arriving from a link, an MCP directory, or a post. **Awareness level:**
problem-aware at best, solution-unaware. Nobody is searching for this category because it
does not exist yet.

**Goal:** the honest conversion event, which today is *read `/status` and believe it*. See
"The capture conflict" below for why it is not a signup.

---

## Constraint note, read before scoring

Two of this skill's defaults are non-starters here and were removed rather than adapted:

1. **The KaiCalls phone CTA.** bay is a local Mac binary bought by developers with a
   personal card. There is no phone demand, no reception pain, no call log. Recommending it
   would fail the fit test in the router's own recommendation-ethics rule. Not applicable.
2. **Perception engineering's confrontational register.** The framework's headline tactics
   ("re-index their virtue as a vice", "you are obeying a fear algorithm you didn't write")
   are directly banned by `website/VOICE.md`, which forbids promotional register, negative
   parallelism, and anything that would read as a slogan generator. The site's whole
   position is that it is not doing the hype thing.

   **Resolution:** the three-layer *structure* is kept and the pressure tactics are dropped.
   Destabilization is done with a fact the reader did not know, not with an accusation.
   Permission is granted by removing the ask, not by future-pacing a purchase. This scores
   lower on the framework's own rubric and is correct anyway. The project docs win.

---

## 5 hero angles, scored

| # | Headline | Subhead direction | CTA | Audience | Clarity | Proof | Diff | Conv | **Total** |
|---|---|---|---|---|---|---|---|---|---|
| **B** | **An agent edits your timeline. ⌘Z undoes it.** | The agent submits the same commands your clicks produce, to the same timeline, on your machine | See what works today | 5 | 4 | 5 | 5 | 4 | **23** ✅ |
| **D** | **Cut it by hand or describe it. Same timeline.** | One Rust engine serves the window and the agent, so the two cannot disagree about what a cut means | See what works today | 5 | 5 | 5 | 4 | 4 | **23** ✅ |
| **A** | A video editor you can talk to. *(current live headline)* | You cut on the timeline the way you always have. You can also describe the change and let something else make it | Keep scrolling | 4 | 5 | 5 | 3 | 4 | **21** ✅ |
| **C** | It renders with no window open. | The same twenty-one tools over MCP, on a machine with no display attached | See the tool list | 4 | 4 | 5 | 5 | 3 | **21** ✅ |
| **E** | Your footage never leaves the Mac. | No server, no account, no upload step | See what works today | 3 | 5 | 5 | 2 | 3 | **18** ❌ |

### Recommendation: **B**, with **A** as the A/B challenger

**A is the current headline and it is good.** It is warm, it is in voice, and it sets up the
scroll sequence. It has one problem, and it is the problem `VOICE.md` itself names as the
useful test: *if the paragraph would work with a competitor's name swapped in, it is not
saying anything.* Descript can print "a video editor you can talk to" tomorrow. Several
already could.

**B cannot be swapped.** No competitor has a timeline an agent writes to through the same
single-writer point and the same undo stack. It is the one sentence in the entire positioning
that is architecture rather than feature, and it is checkable in under a second by the exact
person you want. It scores lower on clarity because it needs one beat to land, which the
scroll sequence immediately provides.

**D is genuinely tied at 23** and is the safer choice. It is clearer on first read and covers
both ICPs. Take D if you think the primary ICP is narrower than the plan assumes.

**E is killed** on differentiation. Every local-first app prints it, it fails the swap test
outright, and it speaks to the secondary ICP the growth plan says not to chase yet.

---

## 3 offer frames, scored

| Frame | What it offers | Verdict |
|---|---|---|
| **Direct outcome — watch it build a real one** | The scroll sequence: a real request carried out, one step per scroll, neither sped up nor rearranged, ending in a reel that exists | **Use it.** With no download, the demonstration *is* the offer. This is already the page's spine and it is the right spine |
| **Risk removal — here is everything that is broken** | `/status`, the open-issues list, "the Windows build is green and has never been run" | **Use it, as the closer.** Unusually strong here. Stating the limits first is the only reason to believe the delivered list, and no funded competitor will copy it |
| **Urgency — act now** | A launch date, a beta cohort cap, a countdown | **Killed.** There is no scarcity and manufacturing one contradicts the entire brand. This costs the page ~2 points on the Four U's *Urgent* axis and it is the correct trade. Noted again in the gate below |

---

## 3 proof plans, scored

| Plan | The evidence | Verdict |
|---|---|---|
| **The reel** | "Volatility Drag": 21.429s, 1080×1920, 30fps, h264 + AAC, built entirely through MCP tool calls. Documented in `docs/native/reel-recipe.md`, including the four defects the build exposed and the test that now covers each | **Primary.** Real, specific, unfakeable, and currently invisible to everyone |
| **The defect ledger** | `/status` and `docs/native/parity-status.md`: long clips play as a low-frame-rate proxy, the media panel lists demo tiles, anamorphic sources render at the wrong aspect | **Secondary.** Proof by limitation. This is the credibility engine of the whole site |
| **The build record** | Tests passing, `clippy -D warnings` clean, `fmt --check` clean | **Third, and handle with care.** See the flag below |

> ⚠️ **Number discrepancy, fix before publishing.** `todo.md` says **386 passing**;
> `docs/native/parity-status.md` says **383 passing**. Both are in the repo right now. A site
> whose entire brand is honesty must not print a stale test count, and a visitor who checks
> two of your own documents will find two numbers. Either read it from one source at build
> time or do not print a number at all. **My recommendation: do not print it.** A test count
> is a number only you can verify, which makes it the weakest of the three proofs and the
> easiest to get wrong.

---

## Kill list

| Rejected | Why |
|---|---|
| "Your footage never leaves the Mac." (hero) | Fails the swap test. Every local app prints it. Works as a body claim, not a headline |
| "The AI video editor that actually works" | Promotional register, banned adjective pattern, and it is the exact hype voice the studio positions against |
| "Edit videos 10x faster" | Unprovable. No benchmark exists, no user has been timed, and inventing one breaks the second site rule |
| "Stop wasting hours in a timeline" | Agitation. `VOICE.md` has no room for it, and the ICP does not experience editing as suffering |
| "Meet Bay" / "Introducing Bay" | Says nothing. Also hardcodes a name that is deliberately a variable |
| "Join the waitlist" | Forbidden by `website/CLAUDE.md`. See below |
| "Native. Local. Yours." | Rule of three, explicitly banned |
| Any urgency device | No scarcity exists. See offer frames |

---

## The capture conflict, and the three ways out

The growth plan made first-party email capture a Week 1 P0. **The site contract forbids it**:

> No download link until there is a build. `download` stays undefined and the button does not
> render. No "coming soon" buttons, **no email capture standing in for one.**

There is a second, independent blocker: the site deploys as static prerendered pages and
makes no third-party requests, so a form needs both a server route and a vendor exception.
Per the site's own instruction, that is a product decision, not a technical one.

| Route | What it is | Compliant today? | Signal quality | Recommendation |
|---|---|---|---|---|
| **1. The considered reply** | Elevate the existing footer `mailto:` into a real closing CTA with a prefilled subject. No form, no endpoint, no vendor | **Yes.** No third-party request, no server, and it is not capture standing in for a download. It is a person writing to a person | Low volume, very high quality. Every reply is a qualified interview lead, which is exactly what Month 1 needs | ✅ **Do this now** |
| **2. First-party form** | A Next route handler on your own domain writing to your own store | **No.** Needs the static-export assumption revisited and the `CLAUDE.md` rule amended, deliberately and in writing | Higher volume, lower intent | Only if you amend the rule on purpose. Do not let it happen as a side effect of a copy change |
| **3. No capture** | Keep `/status` as the only CTA. Take the demand signal from GitHub once the repo is public | Yes | Indirect | Acceptable, and strictly worse than route 1 once the repo is public |

**Route 1 is what the final copy is written for.** It respects the rule as written, needs no
infrastructure, costs nothing, and produces the one thing Month 1 actually needs: people who
have already told you, in their own words, what they would cut with it.
