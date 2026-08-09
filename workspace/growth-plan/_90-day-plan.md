# 90-day growth plan — bay

**Stage:** Pre-Launch ($0) · **Budget:** $0 · **Time:** 15+ hrs/week · **Model:** open core

> The whole plan answers one question: **do people outside this machine want an agent-driven
> local video editor enough to install a pre-release binary?** Nothing here is about
> "awareness". Awareness is the wrong goal when nobody has seen the thing work.

---

## What to DO (prioritized)

| Priority | Activity | Why | /kai skill | Timeline |
|---|---|---|---|---|
| **P0** | **Record the "Volatility Drag" build end to end.** Screen capture of an agent driving the 21 MCP tool calls, the timeline updating live, the `● Claude · <label>` chip firing, then the finished 1080×1920 MP4 playing. Two cuts: 45–60s silent loop, and a 3–4 min uncut version. | Nothing exists. The claim is behavioural and unwitnessed. Every other activity in this plan is an amplifier with nothing to amplify until this exists. It also retires the "no screenshots" rule honestly, because it is the real app. | `/kai-video` | Week 1 |
| **P0** | **Add first-party email capture to the site.** One field, self-hosted endpoint or a static form posting to your own route. No third-party script, no remote font, no tag. Copy per `VOICE.md`. | It is currently impossible for an interested visitor to raise a hand. This is the only conversion event the site can honestly have while there is no download. | `/kai-landing-page` | Week 1 |
| **P0** | **15 customer interviews with MCP-native builders.** Not "would you use this". Ask what they made a video for last, what they actually did, how long it took, what they abandoned. Then show the recording and watch their face. | The stage's entire job. Interviews are also how the copy stops being your words and starts being theirs. | `/kai-brief` for the guide | Weeks 1–4 |
| **P1** | **Make the repo public.** MIT already, fork of OpenCut already. Ship it with `parity-status.md` and `todo.testing.md` intact. | For this ICP, GitHub is the channel. A private repo is a closed shop with a sign in the window. The honest status docs are the reason to look. | — | Week 3 |
| **P1** | **List on MCP directories.** Claude MCP directory, `awesome-mcp-servers` lists, `mcpservers.org`-style registries, the Claude Code docs ecosystem. | Highest-intent free distribution that exists for this product. People browsing MCP registries are exactly the primary ICP, already at the moment of looking for a tool. Nothing else in the plan matches this intent-to-effort ratio. | — | Weeks 3–4 |
| **P1** | **Build in public, 3–4 posts/week on one channel (X, plus cross-post to a dev community).** Post the defects, not the wins. "A rotation-metadata sign bug flipped my phone footage, here is why the signs disagree" outperforms any feature announcement. | Free, compounding, and matches the honesty brand exactly. The founder voice is the asset; it cannot be delegated and does not need budget. | `/kai-social` | Week 2 onward |
| **P1** | **Publish `/agents` as the real quickstart.** The `claude mcp add` line, the 21 tools, one copy-pasteable recipe that reproduces a real reel. | Turns the site from an argument into a thing you can do. The ICP converts on a command they can paste, not a paragraph. | `/kai-write` | Week 4 |
| **P2** | **Two written pieces from the raw material already in `docs/native/`.** (1) "Decode never runs on the render path" — the 10-min clip that froze `render()` for 33s and the fix. (2) "One engine, or the claim is dead" — why an agent submits `Command` values through the same single-writer point. | You already did the work; it is sitting unpublished. This is the cheapest possible content, and it is the kind that earns HN front page and gets cited. Starts the SEO/content loop with a 3–6 month horizon, which is why it is P2 and not P0. | `/kai-write` | Month 2 |
| **P2** | **Ship a notarized build to the waitlist only.** Apple Developer Program, roughly $99/year (confirm current price) — the one unavoidable cost. Private link, not a public download. | Converts a list into users without a launch. Lets you learn from 30 people before 3,000 form an opinion. | — | Month 3 |
| **P3** | **Show HN + Product Hunt.** Only after the notarized build works for strangers. | A one-time spike you can fire exactly once. Firing it at a page with no download wastes it permanently. | `/kai-launch` | Post-90 days |

---

## What NOT to do (this is the load-bearing half)

| Don't do this | Why it's tempting | Why it's wrong at this stage |
|---|---|---|
| **Paid ads** | 15 hrs/week feels like it should buy reach | $0 budget, and more importantly you do not know what converts. Ads pre-PMF buy noise you then have to interpret |
| **An SEO content program** | The engineering docs are genuinely good | 3–6 months to compound and you need an answer in 6 weeks. Publish the two pieces as credibility, not as a programme |
| **Product Hunt / Show HN now** | The build is impressive and you want to show it | You get one first launch. A launch at a site with no download converts curiosity into "not yet" and they do not come back |
| **Logo, brand system, studio identity work** | The site design is already strong and it is enjoyable | The studio name is unsettled (Everholt / Freeholt / Hearth) and the product name is explicitly a variable. Polishing a name that might change is the definition of premature |
| **Adding analytics "just to measure this"** | You cannot see anything and it is maddening | It breaks a stated brand commitment that the site makes no third-party runtime requests. The site is an argument that the software minds its own business, so it has to as well. Count from your own server logs |
| **Chasing the CapCut/Final Cut audience** | It is a vastly bigger market | bay has no slip/slide/roll trims, no audio mixer, most of the inspector unwritten. You would be competing on the axis where you are weakest, and abandoning the one where nobody can follow you |
| **Hiding the known defects to look ready** | The open-issues list is uncomfortable in public | Those defects are the reason the rest is believable. `todo.testing.md` exists precisely so a green build is not mistaken for a working product. That discipline is the brand |
| **Building a Windows launch** | CI is green | It has never been run. Marketing a target you have not opened a window on is how you get your first bug report from a stranger and your last |
| **Marketing automation, lifecycle sequences, a newsletter programme** | `/kai-email-system` is right there | You have 0 subscribers. Capture first. One plain update email to the list every 2–3 weeks is the correct amount of email at this stage |

---

## Growth loop recommendation

Today: **no loop.** New-user acquisition from existing user activity is 0%, because there
are no users. What follows is which loop to build, not the build itself.

### Primary: viral / portable-artifact loop

bay's output is an MP4 — the most portable artifact on the internet, and one people already
publish for their own reasons. The loop:

```
USER describes a cut to their agent
  → bay renders an MP4 on their machine
  → USER publishes it (they were making it to publish anyway)
  → VIEWER sees the video and, crucially, the recipe that made it
  → VIEWER has the aha ("I could describe a video instead of cutting one")
  → VIEWER installs bay, adds the MCP server
  → Repeat
```

- **Transmission trigger, specifically:** the moment the first MP4 lands and they realise
  they did not open a timeline to get it. Not "after using the product".
- **The artifact must carry attribution — and this is a product decision, not a marketing
  one.** A watermark on user output contradicts the manifesto's register. The honest
  version: the *recipe* travels, not a watermark. Make the tool-call transcript exportable
  as a shareable gist, so "here's the prompt that made this" is one click. That is the
  Loom link equivalent, and it is on-brand where a watermark is not.
- **Cycle time:** hours to days. Fast, once it exists.
- **Realistic K:** 0.3–0.6. That amplifies other channels by a third to a half, which at
  this scale is everything.

### Secondary: community / knowledge loop

```
PUBLISH the honest engineering record (parity-status, the defect writeups)
  → It ranks and gets cited because nobody else publishes their broken parts
  → DEVELOPERS arrive for the writeup, find the tool
  → They file issues, recipes, and MCP configs
  → That output is itself indexable content
  → Repeat
```

Slower (months), but it is the loop that fits what you are already producing, and it stacks
with making the repo public.

### Loops explicitly not to build now

- **Invitation/network loop** — the product is single-user, single-window, local, on
  purpose. There is no network effect and manufacturing one would violate the architecture.
- **Paid loop** — no LTV, no CAC, no budget.
- **Sales-assisted loop** — no accounts, so no PQL signals, and no telemetry to derive them.

---

## 90-day roadmap

| Month | Focus | Key activities | Expected outcome |
|---|---|---|---|
| **Month 1** | Make it visible, make it answerable | Record the reel build (2 cuts) · ship first-party email capture · 15 interviews · start posting 3–4×/week | A demo that exists · a list with its first signups · 15 transcripts in the ICP's own words · the wedge either confirmed or falsified |
| **Month 2** | Get in front of the people already looking | Repo public · MCP directory listings · `/agents` quickstart with a paste-able recipe · publish the two engineering pieces | Inbound arrives from a channel you did not manually work · first unsolicited issue or question from a stranger · early read on whether the wedge holds |
| **Month 3** | Turn the list into users | Apple Developer enrolment and notarization · private build to the waitlist · watch 10 people install it and report back · fix what the first install actually breaks | 10–30 real installs · first honest retention signal · a decision, on evidence, about whether Month 4 is a public launch or another cycle of this |

**The go/no-go at day 90:** do at least 10 people who are not you have bay installed, and
have at least 3 rendered something they kept? If yes, plan a launch. If no, the wedge is not
where you think it is, and the interview transcripts will say where it actually is.

---

## Budget allocation

The budget is $0, so the real budget is the 15 hours. Allocating dollars you do not have is
theatre; allocating the hours is the actual decision.

| Activity | % of time | Hrs/week | Why |
|---|---|---|---|
| Customer interviews + synthesis | 30% | ~4.5 | The stage's entire job. Front-loaded to Month 1, tapering after |
| Demo capture, editing, re-cuts | 25% | ~4 | The blocking asset. Heavy in Weeks 1–2, then maintenance as features land |
| Build in public + community presence | 20% | ~3 | The compounding one. Must be constant or it does not work |
| Writing (site copy, quickstart, the two pieces) | 15% | ~2.5 | Converts existing engineering work into distribution |
| Distribution mechanics (repo public, directory listings, list) | 10% | ~1.5 | Small, one-time, high leverage |

### The only cash line, and it is a launch blocker

| Item | Cost | When | Why it is not optional |
|---|---|---|---|
| Apple Developer Program | ~$99/year (confirm current price) | Month 3 | Without notarization, a stranger's Mac refuses the build. No notarization, no download. No download, no launch. Everything in Month 3 depends on this one payment |
| Email capture | $0 | Week 1 | Self-hosted route or a free tier that does not inject a third-party script. Do not let a vendor break the no-third-party-requests commitment |

Everything else at this stage should cost nothing, and anything that starts costing money
before day 90 deserves the question: what did I learn that made this necessary?
