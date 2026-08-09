# Anti-patterns — what not to do, and why

Two kinds. Generic pre-launch mistakes, and mistakes specific to bay that would cost more
here than they would elsewhere.

---

## Stage anti-patterns (pre-launch, standard)

| Don't | Why it's tempting | Why it's wrong here |
|---|---|---|
| Paid ads | 15 hrs/week feels like it should convert into reach | $0 budget, and you do not yet know what message converts. Ads before PMF buy noise you then have to interpret |
| An SEO content programme | The engineering docs are genuinely good material | 3–6 months to compound. You need an answer in 6 weeks. Publish two pieces for credibility, not a calendar |
| Hiring or delegating marketing | It is not your favourite part of the job | The founder voice *is* the asset at this stage, and the interviews are how you learn your customer. Both are non-delegable |
| Brand guidelines, logo, studio identity | The site design is already strong and this is enjoyable work | The studio name is unsettled across three candidates and the product name is deliberately a variable in one file. You would be polishing something scheduled to change |
| Multiple channels at once | 15 hrs feels like enough for four | It is enough for one done properly. Four half-done channels produce four inconclusive results |
| Marketing automation and lifecycle flows | The tooling is right there | 0 subscribers. Nothing to automate. One plain update every 2–3 weeks is correct |

---

## bay-specific anti-patterns (these cost more here)

### 1. Installing analytics "just to see what's happening"

The site's own `PRODUCT.md` commits to no third-party runtime requests: no analytics, no tag
manager, no session recorder, no remotely fetched fonts. The workspace manifesto states
privacy is a property of the software, not a paragraph in the settings.

The site is an argument that the software minds its own business, so it has to as well. A
tracker on the marketing site of a no-telemetry app is the single most quotable
inconsistency you could hand a skeptic, and this ICP checks the network tab. Count from your
own server logs and accept the lower precision.

### 2. Launching before a stranger can install it

You get one first launch. Show HN and Product Hunt convert attention into a permanent
verdict. Pointed at a site with no download, that verdict is "not yet", and the people who
form it do not come back for the second launch. Hold the launch until notarization works.

### 3. Hiding the defects to look ready

The instinct before a launch is to quietly retire `parity-status.md`'s open-issues section
and the "green and never run" line in `todo.testing.md`.

Do the opposite, and state the limits first. The published limits are the only reason to
believe the delivered list. A competitor can copy a feature claim in a sprint; none of them
will publish "the Windows build has never been opened." That asymmetry is the brand, and it
is worth more than looking finished.

### 4. Marketing to the CapCut audience

It is a hundred times bigger and the pain is real. But bay has no slip/slide/roll trims, no
transport, no audio mixer, and most of the inspector unwritten. You would be competing where
you are weakest and abandoning the one axis nobody can follow you on. If interviews say the
agent wedge is not real, that is a finding to act on deliberately, not a pivot to drift into
because the other market seemed easier to talk to.

### 5. Watermarking user output to build the viral loop

The obvious viral mechanic is "Made with bay" on every render. It would work, and it
contradicts the register the whole product is positioned in. An app that mints its own
advertisement into your file is doing exactly the thing the manifesto objects to.

The on-brand version: make the tool-call transcript exportable, so "here is the prompt that
made this" is one click. The recipe travels, not a mark on someone's work.

### 6. Copy that fails the swap test

`VOICE.md` is binding: no em dashes, no rule of three, no promotional adjectives, no -ing
tails, no negative parallelism, second person, present tense. The useful check is the last
one — if the paragraph would work with a competitor's name swapped in, it is not saying
anything.

This matters more than usual because the positioning is anti-hype. Copy that drifts into
marketing register does not just underperform, it falsifies the pitch.

### 7. Announcing the roadmap as though it were the product

Every /kai skill that touches copy must read `MARKETING.md`'s evidence section first. There
are no screenshots, no users, no testimonials, no published benchmarks, no download, no
pricing. A generated asset that invents any of those breaks the one thing the site exists to
protect. When a roadmap item slips after you posted about it, correct it publicly. Honesty
decays by accident, not by decision.

### 8. Treating a green build as a working product

`todo.md` splits into completed, pending, and testing precisely because "done", "not built",
and "built but never run" are three different states. Marketing collapses those three by
default. When you write that something works, check which file it lives in.
