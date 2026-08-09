# Skill routing — which /kai command to run, and when

Every skill below reads `MARKETING.md` first. Two constraints bind all of them and are
recorded there: the `VOICE.md` copy rules, and the evidence list of what does not exist and
must not be fabricated (no screenshots, no users, no testimonials, no benchmarks, no
download, no pricing).

---

## The sequence

```
Week 1   /kai-video          → script and shot plan for the "Volatility Drag" build recording
Week 1   /kai-landing-page   → first-party email capture + the one honest conversion CTA
Week 2   /kai-brief          → the interview guide (15 conversations, not a survey)
Week 2   /kai-social         → build-in-public batch: 3-4 posts/week, one channel
Week 4   /kai-write          → the /agents quickstart, paste-able and real
Month 2  /kai-write          → the two engineering pieces from docs/native/
Month 2  /kai-competitors    → Descript, Remotion, CapCut, OpenCut battlecard
Month 3  /kai-gate           → run every published asset through it before the build goes out
Post-90  /kai-launch         → only once a stranger can install it
```

---

## Per skill, what to ask for

**`/kai-video`** — Week 1, the blocking asset.
Two cuts from one capture: a 45–60s silent loop for social, and a 3–4 min uncut version for
the site and for showing interviewees. The uncut one matters more. Requirements: real app,
real tool calls, the timeline updating live, the `● Claude · <label>` chip visible, the
finished MP4 playing at the end. No motion graphics over it, no music bed, no voiceover
selling it. The thing is the argument.

**`/kai-landing-page`** — Week 1.
Not a redesign; the site is good. One addition: first-party email capture with one optional
qualifying question ("what did you last make a video for?"). Constraint the skill must
honour: no third-party script, no remote font, no embedded widget. The CTA cannot imply a
download exists.

**`/kai-brief`** — Week 2.
An interview guide, not a survey. Past behaviour only: what did you make last, what did you
actually do, how long, what did you abandon. The one question that decides everything:
*what did you try before you gave up?* Include the protocol for showing the recording and
recording the reaction separately from the stated opinion.

**`/kai-social`** — Week 2 onward, batched weekly.
One channel. Post defects and mechanisms, not milestones. Source material is already
written: the 33-second frozen `render()`, the per-clip cache budget that gave N clips N
budgets, the three separate causes of the flaky test suite, the rotation sign bug. Every
post must survive the swap test.

**`/kai-write`** — Week 4 and Month 2.
Week 4: the `/agents` quickstart. The `claude mcp add` line, the 21 tools, one recipe that
reproduces a real reel end to end. Month 2: the two pieces, "Decode never runs on the render
path" and "One engine, or the claim is dead."

**`/kai-competitors`** — Month 2.
Descript, Remotion, CapCut, OpenCut. What you need out of it is one paragraph you can say in
an interview when someone asks "how is this different from Descript", not a deck.

**`/kai-gate`** — Month 3, and before anything public after that.
Every asset, every time. It is the mechanical check that the honesty commitment survived
contact with a deadline.

---

## Skills to skip this quarter, and why

| Skill | Skip because |
|---|---|
| `/kai-email-system` | 0 subscribers. Capture first. Revisit at ~100 |
| `/kai-ad-campaign` | $0 budget, wrong stage |
| `/kai-content-calendar` | Two pieces is not a programme. Revisit if content produces signups |
| `/kai-seo-audit` | Three pages and no traffic. Nothing to audit |
| `/kai-brand` | The studio name and product name are both explicitly unsettled |
| `/kai-launch` | Held until a stranger can install it. You get one first launch |
| `/kai-cold-outreach` | Interviews are warm outreach and serve the same access for a better purpose. Revisit if 15 interviews are hard to source |
| `/kai-analytics` | The no-telemetry commitment makes this an anti-goal. See `_metrics-dashboard.md` |
| `/kai-influencer`, `/kai-abm`, `/kai-partnership`, `/kai-webinar`, `/kai-podcast` | All assume a product a stranger can obtain |

---

## The two decisions this plan defers, on purpose

1. **How open core makes money without accounts, servers, or telemetry.** Live options: a
   paid notarized build, an offline licence key, paid narration voice packs, paid support.
   Decide before any pricing copy exists. Do not let a skill generate a pricing page first
   and reverse-engineer the model from it.

2. **Whether the product name and studio name are settling.** `product.ts` exists so a
   rename is one edit. Every asset produced this quarter should honour that: no name baked
   into a filename, a video title card, or a social handle you cannot change.
